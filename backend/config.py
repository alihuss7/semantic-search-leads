from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:password@127.0.0.1:5433/leads_db"
    google_ai_api_key: str
    google_text_model: str = "gemini-1.5-flash"
    google_embedding_model: str = "models/gemini-embedding-2-preview"
    google_embedding_dim: int = 768
    allowed_origins: str = "http://localhost:3000"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


settings = Settings()
