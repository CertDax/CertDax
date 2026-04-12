import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.api.router import api_router
from app.services.scheduler import start_scheduler, stop_scheduler
from app.utils.crypto import ensure_encryption_key
from app.services.seed import seed_default_cas


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validate required settings
    if not settings.SECRET_KEY:
        raise RuntimeError("SECRET_KEY is not set. Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\"")
    if not settings.CORS_ORIGINS:
        raise RuntimeError("CORS_ORIGINS is not set. Set it to your frontend URL (e.g. https://certdax.example.com)")
    os.makedirs("data", exist_ok=True)
    ensure_encryption_key()
    init_db()
    seed_default_cas()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title=settings.APP_NAME,
    description="SSL Certificate Management Dashboard",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/health")
def health_check():
    return {"status": "ok"}
