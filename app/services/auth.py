from datetime import datetime, timedelta, timezone
import logging

import jwt
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

from app.config import settings

logger = logging.getLogger(__name__)
_password_hash = PasswordHash.recommended()
_SUPPORTED_ALGORITHMS = {"HS256", "HS384", "HS512"}


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return _password_hash.verify(password, hashed_password)
    except UnknownHashError:
        logger.warning("Stored password hash uses an unsupported format; rejecting login")
        return False
    except (TypeError, ValueError):
        return False


def validate_jwt_configuration() -> None:
    secret = settings.jwt_secret_key
    algorithm = settings.jwt_algorithm
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY is not configured")
    if len(secret.encode("utf-8")) < 32:
        raise RuntimeError("JWT_SECRET_KEY must contain at least 32 bytes")
    if algorithm not in _SUPPORTED_ALGORITHMS:
        raise RuntimeError("JWT_ALGORITHM must be HS256, HS384, or HS512")
    if settings.jwt_access_token_expire_minutes < 1:
        raise RuntimeError("JWT_ACCESS_TOKEN_EXPIRE_MINUTES must be at least 1")


def create_access_token(user_id: int) -> str:
    validate_jwt_configuration()
    secret = settings.jwt_secret_key
    algorithm = settings.jwt_algorithm
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    return jwt.encode({"sub": str(user_id), "exp": expires_at}, secret, algorithm=algorithm)


def get_token_subject(token: str) -> int | None:
    secret = settings.jwt_secret_key
    algorithm = settings.jwt_algorithm
    if (
        not secret
        or len(secret.encode("utf-8")) < 32
        or algorithm not in _SUPPORTED_ALGORITHMS
    ):
        return None
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[algorithm],
            options={"require": ["sub", "exp"]},
        )
    except (jwt.PyJWTError, TypeError, ValueError, OverflowError, OSError):
        return None
    subject = payload.get("sub")
    if not isinstance(subject, str) or len(subject) > 19 or not subject.isdecimal():
        return None
    try:
        return int(subject)
    except ValueError:
        return None
