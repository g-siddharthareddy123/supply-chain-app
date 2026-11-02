from getpass import getpass
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import User
from app.schemas import RegisterRequest
from app.services.auth import hash_password


def create_bootstrap_user(db: Session | None = None) -> str:
    if settings.app_env != "development":
        raise RuntimeError("Initial user creation is available only when APP_ENV=development.")
    if not settings.jwt_secret_key or len(settings.jwt_secret_key.encode("utf-8")) < 32:
        raise RuntimeError("Set a JWT_SECRET_KEY with at least 32 bytes before creating a user.")

    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "")
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not email:
        email = input("Planner email: ")
    if not password:
        password = getpass("Initial password (hidden): ")
    try:
        credentials = RegisterRequest(email=email, password=password)
    except ValueError as exc:
        raise RuntimeError("Enter a valid email and a password of at least 12 characters.") from exc
    email = credentials.email
    password = credentials.password

    def create(session: Session) -> str:
        existing = session.scalar(select(User).where(User.email == email))
        if existing:
            return f"User {email} already exists; no changes made."
        session.add(User(email=email, hashed_password=hash_password(password), is_active=True))
        session.commit()
        return f"Created active user {email}."

    if db is not None:
        return create(db)
    with SessionLocal() as session:
        return create(session)


if __name__ == "__main__":
    print(create_bootstrap_user())
