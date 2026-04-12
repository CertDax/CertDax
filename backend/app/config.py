from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "CertDax"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "sqlite:///./data/certdax.db"

    # Security — SECRET_KEY must be set via .env or environment variable
    SECRET_KEY: str = ""
    ENCRYPTION_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 1440

    # ACME
    ACME_CONTACT_EMAIL: str = ""

    # Scheduler
    RENEWAL_CHECK_HOURS: int = 12
    RENEWAL_THRESHOLD_DAYS: int = 30

    # CORS (comma-separated origins, set to your domain in production)
    CORS_ORIGINS: str = ""

    # Agent binaries directory
    AGENT_BINARIES_DIR: str = "agent-dist"

    # Public API base URL (used in agent install scripts)
    # If empty, auto-detected from request headers
    API_BASE_URL: str = ""

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Frontend URL (used for password reset links)
    FRONTEND_URL: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
