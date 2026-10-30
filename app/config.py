import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    app_name = os.getenv("APP_NAME", "Supply Chain Control Tower")
    database_url = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@localhost:3306/supply_chain",
    )
    api_prefix = "/api/v1"
    api_key = os.getenv("API_KEY")


settings = Settings()
