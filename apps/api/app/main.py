from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.api import router as product_router
from app.core.config import get_settings
from app.core.database import engine
from app.custom_llm import router as custom_llm_router
from app.models import Base
from app.official_agora import router as official_agora_router

REQUIRED_PROMPT_CATALOG_SIZE = 12
REQUIRED_PROMPT_CATALOG_QUERY = text(
    """
    select count(*)
    from public.prompt_templates
    where id in (
      '11000000-0000-4000-8000-000000000001'::uuid,
      '11000000-0000-4000-8000-000000000002'::uuid,
      '11000000-0000-4000-8000-000000000003'::uuid,
      '11000000-0000-4000-8000-000000000004'::uuid,
      '11000000-0000-4000-8000-000000000005'::uuid,
      '11000000-0000-4000-8000-000000000006'::uuid,
      '11000000-0000-4000-8000-000000000007'::uuid,
      '11000000-0000-4000-8000-000000000008'::uuid,
      '11000000-0000-4000-8000-000000000009'::uuid,
      '11000000-0000-4000-8000-000000000010'::uuid,
      '11000000-0000-4000-8000-000000000011'::uuid,
      '11000000-0000-4000-8000-000000000012'::uuid
    )
      and is_builtin is true
      and is_active is true
      and knowledge is not null
      and behavior is not null
    """
)


class DatabaseReleaseNotReady(RuntimeError):
    pass


async def verify_production_catalog(connection: AsyncConnection) -> None:
    result = await connection.execute(REQUIRED_PROMPT_CATALOG_QUERY)
    if result.scalar_one() != REQUIRED_PROMPT_CATALOG_SIZE:
        raise DatabaseReleaseNotReady(
            "Required prompt catalog migration 202609010001 is not fully applied"
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    if settings.environment == "development" and settings.database_url.startswith("sqlite"):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Agora-first, evidence-linked multi-role mock interview API.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Agora-Signature-V2"],
)


@app.get("/healthz", tags=["Health"])
@app.get("/health/live", tags=["Health"], include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz", tags=["Health"])
@app.get("/health/ready", tags=["Health"], include_in_schema=False)
async def readiness() -> dict[str, str]:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("select 1"))
            if settings.environment == "production":
                await verify_production_catalog(connection)
    except DatabaseReleaseNotReady as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Database schema and prompt catalog are not release-ready",
        ) from exc
    except Exception as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Database is unavailable") from exc
    return {"status": "ready", "release_sha": settings.release_sha}


app.include_router(official_agora_router)
app.include_router(custom_llm_router)
app.include_router(product_router)
