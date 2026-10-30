"""Create missing database tables from the SQLAlchemy models.

For ongoing schema changes, use Alembic migrations instead.
"""

from app import models  # noqa: F401 - registers model tables in Base.metadata
from app.db import Base, engine


def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    create_tables()
    print("Database tables are ready.")
