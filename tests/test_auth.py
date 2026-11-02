from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.db import get_db
from app.models import User
from app.services.auth import hash_password
from scripts.create_user import create_bootstrap_user


def create_test_user(client, email="planner@example.com", password="correct-horse-battery"):
    db_dependency = client.app.dependency_overrides[get_db]
    db_session = db_dependency()
    db = next(db_session)
    try:
        db.add(User(email=email, hashed_password=hash_password(password), is_active=True))
        db.commit()
    finally:
        db_session.close()


def test_login_returns_signed_token_and_me_requires_active_user(client, monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    monkeypatch.setattr(settings, "api_key", None)
    create_test_user(client)

    invalid = client.post(
        "/api/v1/auth/login",
        json={"email": "planner@example.com", "password": "wrong-password"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Invalid email or password"
    nonexistent = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@example.com", "password": "correct-horse-battery"},
    )
    assert nonexistent.status_code == 401
    assert nonexistent.json()["detail"] == "Invalid email or password"

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "PLANNER@example.com", "password": "correct-horse-battery"},
    )
    assert response.status_code == 200
    token_data = response.json()
    assert token_data["token_type"] == "bearer"
    assert token_data["expires_in"] == settings.jwt_access_token_expire_minutes * 60
    assert "hashed_password" not in str(token_data)

    headers = {"Authorization": f"Bearer {token_data['access_token']}"}
    profile = client.get("/api/v1/auth/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json() == {"id": 1, "email": "planner@example.com", "is_active": True}
    assert client.get("/api/v1/products", headers=headers).status_code == 200


def test_business_routes_reject_missing_invalid_and_expired_tokens(client, monkeypatch):
    monkeypatch.setattr(settings, "api_key", None)
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")

    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/products").status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get(
        "/api/v1/products",
        headers={"Authorization": "Bearer malformed"},
    ).status_code == 401

    expired = jwt.encode(
        {
            "sub": "1",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    assert client.get(
        "/api/v1/products",
        headers={"Authorization": f"Bearer {expired}"},
    ).status_code == 401


def test_bearer_auth_releases_read_transaction_before_inventory_write(client, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "test-api-key")
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    create_test_user(client, password="correct-horse-battery")
    product = client.post(
        "/api/v1/products",
        json={"sku": "JWT-WRITE-1", "name": "JWT write test product"},
    ).json()
    location = client.post(
        "/api/v1/locations",
        json={"code": "JWT-WRITE-L", "name": "JWT write test location"},
    ).json()
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "planner@example.com", "password": "correct-horse-battery"},
    )
    assert login.status_code == 200

    response = client.post(
        "/api/v1/inventory/adjust",
        json={
            "product_id": product["id"],
            "location_id": location["id"],
            "delta": 4,
            "reason": "Verify authenticated development setup",
        },
        headers={
            "Authorization": f"Bearer {login.json()['access_token']}",
            "X-API-Key": "invalid-key",
        },
    )

    assert response.status_code == 200
    assert response.json()["quantity"] == 4


def test_configured_api_key_remains_an_alternate_credential(client, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "configured-test-key")

    assert client.get(
        "/api/v1/products",
        headers={"X-API-Key": "configured-test-key"},
    ).status_code == 200
    assert client.get(
        "/api/v1/products",
        headers={"X-API-Key": "wrong-key"},
    ).status_code == 401
    assert client.get(
        "/api/v1/products",
        headers={
            "X-API-Key": "configured-test-key",
            "Authorization": "Bearer malformed",
        },
    ).status_code == 401


def test_development_bootstrap_user_is_idempotent(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", " New.Planner@example.com ")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "long-development-password")
    db_generator = client.app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        assert create_bootstrap_user(db) == "Created active user new.planner@example.com."
        assert create_bootstrap_user(db) == "User new.planner@example.com already exists; no changes made."
        created_user = db.scalar(select(User).where(User.email == "new.planner@example.com"))
        assert created_user.hashed_password != "long-development-password"
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "new.planner@example.com", "password": "long-development-password"},
        )
        assert response.status_code == 200
        assert "access_token" in response.json()
    finally:
        db_generator.close()


def test_development_bootstrap_refuses_production_environment(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", "planner@example.com")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "long-development-password")

    try:
        create_bootstrap_user()
    except RuntimeError as error:
        assert "APP_ENV=development" in str(error)
    else:
        raise AssertionError("User bootstrap should be blocked outside development.")


def test_unsupported_password_hash_fails_closed_without_server_error(client, monkeypatch, caplog):
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    db_generator = client.app.dependency_overrides[get_db]()
    db = next(db_generator)
    db.add(User(
        email="bad-hash@example.com",
        hashed_password="legacy-or-corrupt-unsupported-hash",
        is_active=True,
    ))
    db.commit()
    db_generator.close()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "bad-hash@example.com", "password": "untrusted-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert "untrusted-password" not in caplog.text
    assert "bad-hash@example.com" not in caplog.text


def test_development_registration_hashes_password_and_allows_login(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    email = "  New.Planner@example.com "
    password = "long-development-password"

    registered = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    assert registered.status_code == 201
    assert registered.json()["email"] == "new.planner@example.com"
    assert registered.json()["is_active"] is True
    assert "hashed_password" not in registered.json()

    db_generator = client.app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        user = db.scalar(select(User).where(User.email == "new.planner@example.com"))
        assert user is not None
        assert user.hashed_password != password
    finally:
        db_generator.close()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "NEW.PLANNER@example.com", "password": password},
    )
    assert login.status_code == 200
    assert login.json()["token_type"] == "bearer"
    assert client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    ).status_code == 200

    invalid = client.post(
        "/api/v1/auth/login",
        json={"email": "new.planner@example.com", "password": "incorrect-password"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Invalid email or password"


def test_registration_rejects_duplicate_normalized_email(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    payload = {"email": "planner@example.com", "password": "long-development-password"}

    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    duplicate = client.post(
        "/api/v1/auth/register",
        json={"email": " PLANNER@example.com ", "password": "another-long-password"},
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "An account with this email already exists."


def test_registration_validates_password_and_is_disabled_outside_development(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "jwt_secret_key", "unit-test-only-jwt-secret-value-32")
    invalid = client.post(
        "/api/v1/auth/register",
        json={"email": "planner@example.com", "password": "too-short"},
    )
    assert invalid.status_code == 422

    monkeypatch.setattr(settings, "app_env", "production")
    blocked = client.post(
        "/api/v1/auth/register",
        json={"email": "planner@example.com", "password": "long-development-password"},
    )
    assert blocked.status_code == 403


def test_registration_requires_jwt_configuration_before_creating_user(client, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "jwt_secret_key", None)

    response = client.post(
        "/api/v1/auth/register",
        json={"email": "planner@example.com", "password": "long-development-password"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication is not configured"}
    db_generator = client.app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        assert db.scalar(select(User).where(User.email == "planner@example.com")) is None
    finally:
        db_generator.close()


def test_login_database_failure_is_logged_and_mapped_safely(client, monkeypatch, caplog):
    original_db = client.app.dependency_overrides[get_db]

    def failing_db():
        db_generator = original_db()
        db = next(db_generator)

        def fail_lookup(_statement):
            raise OperationalError(
                "SELECT users",
                {"email": "private@example.com"},
                RuntimeError("db offline"),
            )

        db.scalar = fail_lookup
        try:
            yield db
        finally:
            db_generator.close()

    monkeypatch.setitem(client.app.dependency_overrides, get_db, failing_db)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "private@example.com", "password": "do-not-log-this-password"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication service is temporarily unavailable"}
    assert "Database error while processing login" in caplog.text
    assert "do-not-log-this-password" not in caplog.text
