import pytest
from sqlalchemy.engine import make_url

from app.config import (
    AIVEN_MYSQL_HOST,
    build_database_url,
    resolve_ca_certificate,
    validate_aiven_database,
)
from app import db as database


def aiven_url(
    username="avnadmin",
    password=None,
    host=AIVEN_MYSQL_HOST,
    port=13853,
    database_name="defaultdb",
):
    credential = ":{}".format(password) if password is not None else ""
    return make_url(
        "mysql+pymysql://{}{}@{}:{}/{}".format(
            username, credential, host, port, database_name
        )
    )


def test_database_password_is_added_as_a_url_component():
    password = "p@ss:/?#%:word"
    url = build_database_url(
        "mysql+pymysql://avnadmin@{}:13853/defaultdb".format(AIVEN_MYSQL_HOST),
        password,
    )

    assert url.password == password
    assert make_url(url.render_as_string(hide_password=False)).password == password


def test_blank_separate_password_does_not_override_url_password():
    url = build_database_url(
        "mysql+pymysql://avnadmin:encoded%40password@{}:13853/defaultdb".format(
            AIVEN_MYSQL_HOST
        ),
        "",
    )

    assert url.password == "encoded@password"


def test_aiven_target_requires_password_and_ca_certificate(tmp_path):
    ca_file = tmp_path / "ca.pem"
    ca_file.write_text("test certificate path", encoding="utf-8")

    validate_aiven_database(aiven_url(password="secret"), str(ca_file))

    with pytest.raises(RuntimeError, match="DATABASE_PASSWORD"):
        validate_aiven_database(aiven_url(), str(ca_file))
    with pytest.raises(RuntimeError, match="AIVEN_CA_CERT"):
        validate_aiven_database(aiven_url(password="secret"), None)


@pytest.mark.parametrize(
    "url",
    [
        aiven_url(username="unexpected", password="secret"),
        aiven_url(password="secret", host="other.aivencloud.com"),
        aiven_url(password="secret", port=3306),
        aiven_url(password="secret", database_name="otherdb"),
    ],
)
def test_aiven_target_rejects_unexpected_connection_details(url, tmp_path):
    ca_file = tmp_path / "ca.pem"
    ca_file.write_text("test certificate path", encoding="utf-8")

    with pytest.raises(RuntimeError, match="Aiven database configuration"):
        validate_aiven_database(url, str(ca_file))


def test_aiven_connection_enables_ca_and_hostname_verification(monkeypatch, tmp_path):
    ca_file = tmp_path / "ca.pem"
    ca_file.write_text("test certificate path", encoding="utf-8")
    monkeypatch.setattr(database.settings, "database_url", aiven_url(password="secret"))
    monkeypatch.setattr(database.settings, "aiven_ca_cert", str(ca_file))
    cparams = {}

    database.configure_database_connection(None, None, (), cparams)

    assert cparams == {
        "ssl_ca": str(ca_file),
        "ssl_verify_cert": True,
        "ssl_verify_identity": True,
    }


def test_aiven_validation_error_does_not_expose_password(tmp_path):
    secret = "never-print-this"
    with pytest.raises(RuntimeError) as error:
        validate_aiven_database(aiven_url(password=secret), None)

    assert secret not in str(error.value)


def test_relative_ca_certificate_path_is_resolved_from_project_root(monkeypatch, tmp_path):
    ca_file = tmp_path / "certs" / "ca.pem"
    ca_file.parent.mkdir()
    ca_file.write_text("test certificate path", encoding="utf-8")
    monkeypatch.setattr("app.config.PROJECT_ROOT", tmp_path)

    assert resolve_ca_certificate("certs/ca.pem") == str(ca_file.resolve())
