from pathlib import Path
import os

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")


class Settings:
    app_name = os.getenv("APP_NAME", "Supply Chain Control Tower")
    app_env = os.getenv("APP_ENV", "production").strip().lower()
    database_url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@localhost:3306/supply_chain",
    )
    api_prefix = "/api/v1"
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
