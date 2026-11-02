from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import AIVEN_MYSQL_HOST, settings, validate_aiven_database

is_sqlite = settings.database_url.drivername.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=connect_args,
)


@event.listens_for(engine, "do_connect")
def configure_database_connection(_dialect, _connection_record, _cargs, cparams):
    validate_aiven_database(settings.database_url, settings.aiven_ca_cert)
    if settings.database_url.host == AIVEN_MYSQL_HOST:
        cparams.update(
            ssl_ca=settings.aiven_ca_cert,
            ssl_verify_cert=True,
            ssl_verify_identity=True,
        )


if is_sqlite:
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
