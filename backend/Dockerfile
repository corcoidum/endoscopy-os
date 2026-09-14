# syntax=docker/dockerfile:1.7

FROM python:3.13.7-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

RUN groupadd --gid 10001 clinic \
    && useradd --uid 10001 --gid clinic --no-create-home --shell /usr/sbin/nologin clinic

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --requirement requirements.txt

COPY --chown=clinic:clinic backend/app ./app
COPY --chown=clinic:clinic alembic.ini ./alembic.ini
COPY --chown=clinic:clinic migrations ./migrations

# Alembic Console Entrypoint가 Application Module과 초기 Migration을 실제로
# 불러올 수 있는지 Image Build 단계에서 Database 연결 없이 확인한다.
RUN APP_ENV=test \
    DATABASE_URL=postgresql+psycopg://build:build@localhost/build \
    alembic upgrade head --sql > /dev/null

USER clinic

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
