"""Create initial supply chain schema.

Revision ID: 0001_initial_schema
Revises:
"""
from alembic import op

from app.db import Base
from app import models  # noqa: F401

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    tables = [table for table in Base.metadata.sorted_tables if table.name != "users"]
    Base.metadata.create_all(bind=op.get_bind(), tables=tables)


def downgrade():
    Base.metadata.drop_all(bind=op.get_bind())
