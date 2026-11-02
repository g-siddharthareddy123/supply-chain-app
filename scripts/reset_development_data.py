"""Safely clear local development business data without changing the schema or users."""

import argparse
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import func, inspect, select, text
from sqlalchemy.engine import Connection, URL, make_url

from app.config import settings
from app.db import engine
from app import models  # noqa: F401
from app.db import Base

EXPECTED_DATABASE = "supply_chain"
EXPECTED_PORT = 3306
LOCAL_DATABASE_HOSTS = {"localhost", "127.0.0.1", "::1"}
PRESERVED_TABLES = {"users", "alembic_version"}
RESET_TABLES = {
    "products",
    "locations",
    "inventory",
    "inbound_receipts",
    "customer_orders",
    "order_lines",
    "allocations",
    "shipments",
    "shipment_lines",
    "exceptions",
    "ai_interactions",
    "customer_messages",
    "audit_logs",
}


def validate_target(app_env: str, url: URL) -> None:
    if app_env.strip().lower() != "development":
        raise RuntimeError("Refusing reset: APP_ENV must be development.")
    if not url.drivername.startswith("mysql"):
        raise RuntimeError("Refusing reset: configured database must be MySQL.")
    if url.host not in LOCAL_DATABASE_HOSTS:
        raise RuntimeError("Refusing reset: database host must be local.")
    if url.port != EXPECTED_PORT:
        raise RuntimeError(f"Refusing reset: database port must be {EXPECTED_PORT}.")
    if url.database != EXPECTED_DATABASE:
        raise RuntimeError(
            f"Refusing reset: database must be named {EXPECTED_DATABASE!r}."
        )


def validate_backup_file(
    backup_file: str | Path,
    required_tables: set[str],
    populated_tables: set[str],
) -> Path:
    path = Path(backup_file).expanduser().resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("Refusing reset: backup file does not exist or is empty.")

    required_markers = {
        f"CREATE TABLE `{table_name}`" for table_name in required_tables
    } | {f"INSERT INTO `{table_name}`" for table_name in populated_tables}
    found_markers: set[str] = set()
    with path.open("r", encoding="utf-8", errors="replace") as backup:
        for line in backup:
            found_markers.update(marker for marker in required_markers if marker in line)
            if len(found_markers) == len(required_markers):
                break
    if len(found_markers) != len(required_markers):
        raise RuntimeError(
            "Refusing reset: backup file is missing required table definitions or "
            "data rows for tables that are currently populated."
        )
    return path


def deletion_order(table_names: set[str]) -> list[str]:
    """Return a child-before-parent order for the selected tables."""
    children_by_parent: dict[str, set[str]] = defaultdict(set)
    parents_by_child: dict[str, set[str]] = defaultdict(set)

    for table_name in table_names:
        table = Base.metadata.tables[table_name]
        for foreign_key in table.foreign_keys:
            parent_name = foreign_key.column.table.name
            if parent_name in table_names and parent_name != table_name:
                children_by_parent[parent_name].add(table_name)
                parents_by_child[table_name].add(parent_name)

    ready = sorted(name for name in table_names if not children_by_parent[name])
    ordered: list[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for parent_name in sorted(parents_by_child[current]):
            children_by_parent[parent_name].discard(current)
            if (
                not children_by_parent[parent_name]
                and parent_name not in ordered
                and parent_name not in ready
            ):
                ready.append(parent_name)
        ready.sort()

    if len(ordered) != len(table_names):
        raise RuntimeError("Refusing reset: cyclic foreign-key dependencies detected.")
    return ordered


def validate_schema(connection: Connection) -> None:
    actual_tables = set(inspect(connection).get_table_names())
    model_tables = set(Base.metadata.tables)
    expected_tables = RESET_TABLES | {"users"}

    if model_tables != expected_tables:
        raise RuntimeError(
            "Refusing reset: the SQLAlchemy model table set differs from the "
            "reviewed reset allowlist."
        )
    expected_database_tables = RESET_TABLES | PRESERVED_TABLES
    if actual_tables != expected_database_tables:
        missing = sorted(expected_database_tables - actual_tables)
        unexpected = sorted(actual_tables - expected_database_tables)
        raise RuntimeError(
            "Refusing reset: database schema does not match the reviewed tables "
            f"(missing={missing}, unexpected={unexpected})."
        )

    engines = dict(
        connection.execute(
            text(
                "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
            )
        ).all()
    )
    non_transactional = sorted(
        name
        for name in RESET_TABLES | {"users"}
        if engines.get(name) != "InnoDB"
    )
    if non_transactional:
        raise RuntimeError(
            "Refusing reset: transactional InnoDB tables are required "
            f"(non-InnoDB tables: {non_transactional})."
        )


def row_counts(connection: Connection) -> dict[str, int]:
    counts = {
        table_name: int(
            connection.scalar(
                select(func.count()).select_from(Base.metadata.tables[table_name])
            )
        )
        for table_name in sorted(RESET_TABLES | {"users"})
    }
    counts["alembic_version"] = int(
        connection.scalar(text("SELECT COUNT(*) FROM `alembic_version`"))
    )
    return counts


def show_target(connection: Connection, url: URL) -> dict[str, int]:
    validate_schema(connection)
    actual_database, server_name = connection.execute(
        text("SELECT DATABASE(), @@hostname")
    ).one()
    if actual_database != EXPECTED_DATABASE:
        raise RuntimeError(
            f"Refusing reset: server selected unexpected database {actual_database!r}."
        )

    counts = row_counts(connection)
    print("DEVELOPMENT DATA RESET PREVIEW")
    print(f"Environment: {settings.app_env}")
    print(
        f"Database target: "
        f"{url.drivername}://{url.host}:{url.port}/{actual_database}"
    )
    print(f"MySQL server: {server_name}")
    print("Proposed deletion order (all current rows will be permanently deleted):")
    for table_name in deletion_order(RESET_TABLES):
        print(f"  {table_name}: {counts[table_name]} row(s)")
    print(f"Will preserve users: {counts['users']} row(s)")
    print(f"Will preserve alembic_version: {counts['alembic_version']} row(s)")
    print("Will preserve all table structures.")
    return counts


def clear_development_data(
    connection: Connection, expected_counts: dict[str, int]
) -> dict[str, int]:
    deleted: dict[str, int] = {}
    with connection.begin():
        validate_schema(connection)
        before = row_counts(connection)
        if before != expected_counts:
            raise RuntimeError(
                "Refusing reset: database row counts changed after preview. "
                "Run the dry-run again and review the new counts."
            )
        for table_name in deletion_order(RESET_TABLES):
            result = connection.execute(Base.metadata.tables[table_name].delete())
            deleted[table_name] = int(result.rowcount or 0)

        after = row_counts(connection)
        remaining = {name: after[name] for name in RESET_TABLES if after[name] != 0}
        if remaining:
            raise RuntimeError(
                f"Reset verification failed; transaction will roll back: {remaining}"
            )
        if after["users"] != before["users"]:
            raise RuntimeError(
                "Reset verification failed; user account count changed."
            )
        if after["alembic_version"] != before["alembic_version"]:
            raise RuntimeError(
                "Reset verification failed; migration history count changed."
            )
    return deleted


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Preview local development business-data cleanup by default. "
            "Deletion requires --apply and a verified mysqldump backup."
        )
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="show target, row counts, and deletion order without changing data (default)",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="apply the cleanup after backup validation and interactive confirmation",
    )
    parser.add_argument(
        "--backup-file",
        help="existing mysqldump file to verify (required with --apply)",
    )
    args = parser.parse_args(argv)
    if args.apply and not args.backup_file:
        parser.error("--backup-file is required with --apply")
    if args.backup_file and not args.apply:
        parser.error("--backup-file can only be used with --apply")

    url = make_url(settings.database_url)
    validate_target(settings.app_env, url)

    with engine.connect() as connection:
        before = show_target(connection, url)
        connection.commit()
        if not args.apply:
            print("Dry run only; no data was changed.")
            return 0

        populated_tables = {
            table_name for table_name, count in before.items() if count > 0
        }
        backup_path = validate_backup_file(
            args.backup_file,
            required_tables=RESET_TABLES | PRESERVED_TABLES,
            populated_tables=populated_tables,
        )
        print(f"Backup file checks passed: {backup_path}")
        print(
            "\nThis permanently deletes the displayed development business "
            "data. User accounts and database tables will be preserved."
        )
        try:
            confirmation = input(
                f"Type RESET {EXPECTED_DATABASE} to continue: "
            ).strip()
        except EOFError:
            print("\nNo interactive confirmation received; reset cancelled.")
            return 1
        if confirmation != f"RESET {EXPECTED_DATABASE}":
            print("Confirmation did not match; reset cancelled.")
            return 1

        deleted = clear_development_data(connection, before)
        print("\nReset complete. Deleted rows:")
        for table_name in deletion_order(RESET_TABLES):
            print(f"  {table_name}: {deleted.get(table_name, 0)}")
        print(f"Preserved user accounts: {before['users']}")
        print("Database schema and alembic_version were not changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
