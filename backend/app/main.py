from __future__ import annotations

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

# Alembic과 Runtime이 동일한 metadata를 사용한다. `app = create_app()`가 Module
# 이름을 가리지 않도록 Submodule만 가져온다.
from app import models  # noqa: F401
from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.exceptions import ApiError, register_exception_handlers
from app.core.network import InternalNetworkMiddleware
from app.core.rate_limit import LoginFailureThrottle
from app.db.session import get_db
from app.schemas.common import HealthResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    app = FastAPI(
        title=runtime_settings.app_name,
        docs_url="/api/docs" if runtime_settings.enable_api_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json"
        if runtime_settings.enable_api_docs
        else None,
    )
    app.state.settings = runtime_settings
    app.state.login_throttle = LoginFailureThrottle(
        max_failures=runtime_settings.login_ip_max_failures,
        window_seconds=runtime_settings.login_ip_window_minutes * 60,
    )
    app.dependency_overrides[get_settings] = lambda: runtime_settings

    app.add_middleware(
        InternalNetworkMiddleware,
        settings=runtime_settings,
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list(runtime_settings.allowed_hosts),
    )

    register_exception_handlers(app)
    app.include_router(api_router, prefix=runtime_settings.api_prefix)

    @app.middleware("http")
    async def add_security_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get("/health/live", response_model=HealthResponse, tags=["health"])
    def health_live() -> HealthResponse:
        return HealthResponse(status="ok", service=runtime_settings.app_name)

    @app.get("/health/ready", response_model=HealthResponse, tags=["health"])
    def health_ready(db: Session = Depends(get_db)) -> HealthResponse:
        try:
            db.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise ApiError(
                status_code=503,
                code="DATABASE_NOT_READY",
                message="Database 연결을 확인해 주세요.",
            ) from exc
        return HealthResponse(status="ready", service=runtime_settings.app_name)

    return app


app = create_app()
