from pathlib import Path
import os

from dotenv import load_dotenv
from sqlalchemy.exc import ArgumentError
from sqlalchemy.engine import URL, make_url

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

AIVEN_MYSQL_HOST = "mysql-38ceb870-siddharthareddyganta-be20.e.aivencloud.com"


def build_database_url(database_url: str, password: str | None = None) -> URL:
    try:
        url = make_url(database_url)
    except (ArgumentError, TypeError, ValueError):
        raise RuntimeError(
            "DATABASE_URL must be a valid SQLAlchemy database URL."
        ) from None
    if password:
        url = url.set(password=password)
    return url


def validate_aiven_database(url: URL, ca_certificate: str | None) -> None:
    if not url.host or not url.host.endswith(".aivencloud.com"):
        return
    if (
        url.drivername != "mysql+pymysql"
        or url.host != AIVEN_MYSQL_HOST
        or url.username != "avnadmin"
        or url.port != 13853
        or url.database != "defaultdb"
    ):
        raise RuntimeError(
            "Aiven database configuration must use the expected MySQL driver, "
            "avnadmin account, host, port, and defaultdb database."
        )
    if not url.password:
        raise RuntimeError(
            "DATABASE_PASSWORD or a password in DATABASE_URL is required for Aiven MySQL."
        )
    if not ca_certificate or not Path(ca_certificate).is_file():
        raise RuntimeError(
            "AIVEN_CA_CERT must point to the downloaded Aiven CA certificate file."
        )


class Settings:
    app_name = os.getenv("APP_NAME", "Supply Chain Control Tower")
    app_env = os.getenv("APP_ENV", "production").strip().lower()
    database_url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@localhost:3306/supply_chain",
    )
    api_prefix = "/api/v1"
    database_url = build_database_url(database_url, os.getenv("DATABASE_PASSWORD"))
    aiven_ca_cert = os.getenv("AIVEN_CA_CERT")
    api_key = os.getenv("API_KEY")
    jwt_secret_key = os.getenv("JWT_SECRET_KEY")
    jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_access_token_expire_minutes = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    cors_origins = [
        origin.strip().rstrip("/")
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        if origin.strip()
    ]


settings = Settings()
