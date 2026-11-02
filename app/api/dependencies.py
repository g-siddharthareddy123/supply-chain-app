import secrets

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User
from app.services.auth import get_token_subject

_bearer_scheme = HTTPBearer(auto_error=False)


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()
    user_id = get_token_subject(credentials.credentials)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise unauthorized()
    return user


def require_auth(
    x_api_key: str | None = Header(default=None),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> None:
    if credentials is not None and credentials.scheme.lower() == "bearer":
        user_id = get_token_subject(credentials.credentials)
        user = db.get(User, user_id) if user_id is not None else None
        if user is not None and user.is_active:
            db.rollback()
            return
        raise unauthorized()
    if (
        settings.api_key
        and x_api_key
        and secrets.compare_digest(x_api_key.encode(), settings.api_key.encode())
    ):
        return
    raise unauthorized()
