import pytest
from sqlalchemy.engine import make_url

from app.db import Base
from scripts.reset_development_data import (
    PRESERVED_TABLES,
    RESET_TABLES,
    deletion_order,
    validate_backup_file,
    validate_target,
)


def test_reset_scope_preserves_users_and_migration_table():
    assert "users" not in RESET_TABLES
    assert "alembic_version" not in RESET_TABLES
    assert PRESERVED_TABLES == {"users", "alembic_version"}


def test_deletion_order_places_referencing_rows_before_parent_rows():
    order = deletion_order(RESET_TABLES)
    positions = {table_name: index for index, table_name in enumerate(order)}

    assert set(order) == RESET_TABLES
    for table_name in RESET_TABLES:
        for foreign_key in Base.metadata.tables[table_name].foreign_keys:
            referenced_table = foreign_key.column.table.name
            if referenced_table in RESET_TABLES:
                assert positions[table_name] < positions[referenced_table]


def test_target_accepts_only_local_development_mysql_database():
    validate_target(
        "development",
        make_url("mysql+pymysql://user:password@localhost:3306/supply_chain"),
    )


@pytest.mark.parametrize(
    ("app_env", "url"),
    [
        ("production", "mysql+pymysql://user:password@localhost:3306/supply_chain"),
        ("development", "sqlite:///local.db"),
        ("development", "mysql+pymysql://user:password@db.example:3306/supply_chain"),
        ("development", "mysql+pymysql://user:password@localhost:3307/supply_chain"),
        ("development", "mysql+pymysql://user:password@localhost:3306/other_db"),
    ],
)
def test_target_validation_fails_closed(app_env, url):
    with pytest.raises(RuntimeError, match="Refusing reset"):
        validate_target(app_env, make_url(url))


def test_backup_validation_requires_dump_of_schema_and_auth_table(tmp_path):
    backup = tmp_path / "supply_chain.sql"
    backup.write_text(
        "CREATE TABLE `users` (...);\nINSERT INTO `users` VALUES (...);\n"
        "CREATE TABLE `products` (...);\nINSERT INTO `products` VALUES (...);\n"
        "CREATE TABLE `alembic_version` (...);\n"
        "INSERT INTO `alembic_version` VALUES (...);\n",
        encoding="utf-8",
    )

    assert validate_backup_file(
        backup,
        required_tables={"users", "products", "alembic_version"},
        populated_tables={"users", "products", "alembic_version"},
    ) == backup.resolve()


@pytest.mark.parametrize(
    "contents",
    [
        "",
        "not a database dump",
        "CREATE TABLE `products` (...);",
        "CREATE TABLE `users` (...);\n"
        "CREATE TABLE `products` (...);\n"
        "CREATE TABLE `alembic_version` (...);\n",
    ],
)
def test_backup_validation_rejects_empty_or_incomplete_dump(tmp_path, contents):
    backup = tmp_path / "incomplete.sql"
    backup.write_text(contents, encoding="utf-8")

    with pytest.raises(RuntimeError, match="backup file"):
        validate_backup_file(
            backup,
            required_tables={"users", "products", "alembic_version"},
            populated_tables={"users"},
        )


def test_backup_validation_rejects_missing_file(tmp_path):
    with pytest.raises(RuntimeError, match="backup file"):
        validate_backup_file(
            tmp_path / "missing.sql",
            required_tables={"users"},
            populated_tables={"users"},
        )
