from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    if settings.database_url is None:  # model validator가 항상 구성하지만 타입을 좁힌다.
        raise RuntimeError("DATABASE_URL을 구성할 수 없습니다.")
    connect_args: dict[str, str] = {}
    if settings.database_url.startswith("postgresql"):
        # 예약 시각 해석이 Server 기본 Timezone 설정에 좌우되지 않도록 고정한다.
        connect_args["options"] = "-c timezone=Asia/Seoul"
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        future=True,
        connect_args=connect_args,
    )


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(),
        class_=Session,
        expire_on_commit=False,
        autoflush=False,
    )


def get_db() -> Generator[Session, None, None]:
    with get_session_factory()() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
