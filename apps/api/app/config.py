from functools import lru_cache
from pathlib import Path

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

    # Google Cloud Text-to-Speech. Application Default Credentials are used.
    # Prefer ENGINE + GENDER. GOOGLE_TTS_VOICE overrides both when set.
    google_tts_enabled: bool = False
    google_tts_engine: str = "neural2"
    google_tts_gender: str = "male"
    google_tts_chirp_persona: str = ""
    google_tts_voice: str = ""
    tts_cache_dir: str = ""

    # Optional Gemini (reader explain + publisher metadata suggest). Glossary-first works with AI off.
    ai_explain_enabled: bool = False
    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_model: str = "gemini-3.5-flash-lite"

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

    @property
    def resolved_tts_cache_dir(self) -> str:
        return self.tts_cache_dir.strip() or str(Path(self.upload_dir) / "tts-cache")

    @property
    def resolved_tts_voice(self) -> str:
        # Local import avoids a circular dependency with app.tts.
        from .tts import resolve_voice

        return resolve_voice(
            self.google_tts_engine,
            self.google_tts_gender,
            chirp_persona=self.google_tts_chirp_persona,
            voice_override=self.google_tts_voice,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
