from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://read:read@localhost:5432/read"
    upload_dir: str = "uploads"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    seed_demo: bool = True
    max_upload_mb: int = 20

    # Firebase Admin. When project id is empty, AUTH_DEV_MODE tokens are used instead.
    firebase_project_id: str = ""
    firebase_credentials_json: str = ""
    admin_emails: str = "admin@read.app"
    auth_dev_mode: bool = True
    auth_dev_secret: str = "read-dev-firebase-standin-secret-change-me"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def admin_email_set(self) -> set[str]:
        return {
            email.strip().lower()
            for email in self.admin_emails.split(",")
            if email.strip()
        }

    @property
    def firebase_enabled(self) -> bool:
        project_id = self.firebase_project_id.strip()
        return bool(project_id and not project_id.startswith("replace-with-"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
