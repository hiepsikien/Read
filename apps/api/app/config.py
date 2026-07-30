from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://read:read@localhost:5432/read"
    jwt_secret: str = "read-mvp-dev-secret-change-in-production-32chars"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24 * 14
    upload_dir: str = "uploads"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    seed_demo: bool = True
    max_upload_mb: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
