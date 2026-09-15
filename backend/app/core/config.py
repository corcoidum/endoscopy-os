from __future__ import annotations

from functools import lru_cache
import secrets
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy import URL, make_url


class Settings(BaseSettings):
    """Environment-driven settings with conservative production defaults."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "Clinic Endoscopy Operations System"
    environment: Literal["development", "test", "production"] = Field(
        default="production", validation_alias="APP_ENV"
    )
    database_url: str | None = None
    database_host: str = "localhost"
    database_port: int = 5432
    postgres_db: str = "clinic_endoscopy"
    postgres_user: str = "clinic_app"
    postgres_password: SecretStr | None = None
    session_secret: SecretStr | None = None
    field_encryption_key: SecretStr | None = None
    api_prefix: str = "/api"
    enable_api_docs: bool = False

    session_cookie_name: str = "__Host-clinic_session"
    session_cookie_secure: bool = True
    session_cookie_samesite: Literal["strict", "lax", "none"] = "strict"
    session_idle_minutes: int = 30
    session_absolute_hours: int = 10
    session_touch_interval_seconds: int = 60
    bind_session_to_ip: bool = True

    csrf_header_name: str = "X-CSRF-Token"
    csrf_require_origin: bool = True
    allowed_origins: Annotated[tuple[str, ...], NoDecode] = (
        "https://clinic.local",
    )

    max_login_failures: int = 5
    login_lock_minutes: int = 15
    login_ip_max_failures: int = 10
    login_ip_window_minutes: int = 15

    enforce_internal_subnet: bool = True
    allowed_subnets: Annotated[tuple[str, ...], NoDecode] = (
        "127.0.0.0/8",
        "::1/128",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
    )
    trust_proxy_headers: bool = True
    trusted_proxy_subnets: Annotated[tuple[str, ...], NoDecode] = (
        "127.0.0.0/8",
        "::1/128",
        "172.16.0.0/12",
    )
    allowed_hosts: Annotated[tuple[str, ...], NoDecode] = (
        "clinic.local",
        "localhost",
        "127.0.0.1",
        "testserver",
    )

    @field_validator(
        "allowed_origins",
        "allowed_subnets",
        "trusted_proxy_subnets",
        "allowed_hosts",
        mode="before",
    )
    @classmethod
    def parse_comma_separated_values(
        cls, value: str | tuple[str, ...] | list[str]
    ) -> tuple[str, ...] | list[str]:
        if isinstance(value, str):
            return tuple(item.strip() for item in value.split(",") if item.strip())
        return value

    @field_validator(
        "session_idle_minutes",
        "session_absolute_hours",
        "session_touch_interval_seconds",
        "max_login_failures",
        "login_lock_minutes",
        "login_ip_max_failures",
        "login_ip_window_minutes",
    )
    @classmethod
    def positive_security_value(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("보안 관련 시간과 횟수는 0보다 커야 합니다.")
        return value

    @model_validator(mode="after")
    def build_database_url_and_enforce_policy(self) -> Settings:
        effective_database_password: str | None
        if self.database_url is None:
            effective_database_password = (
                self.postgres_password.get_secret_value()
                if self.postgres_password is not None
                else None
            )
            self.database_url = URL.create(
                drivername="postgresql+psycopg",
                username=self.postgres_user,
                password=effective_database_password,
                host=self.database_host,
                port=self.database_port,
                database=self.postgres_db,
            ).render_as_string(hide_password=False)
        else:
            parsed_url = make_url(self.database_url)
            effective_database_password = parsed_url.password
            if parsed_url.drivername in {"postgres", "postgresql"}:
                parsed_url = parsed_url.set(drivername="postgresql+psycopg")
                self.database_url = parsed_url.render_as_string(
                    hide_password=False
                )
            elif (
                self.environment == "production"
                and parsed_url.drivername != "postgresql+psycopg"
            ):
                raise ValueError(
                    "운영 DATABASE_URL은 sync postgresql+psycopg Driver를 사용해야 합니다."
                )
        if self.session_secret is None:
            if self.environment == "production":
                raise ValueError(
                    "운영 환경에는 SESSION_SECRET을 반드시 설정해야 합니다."
                )
            self.session_secret = SecretStr(secrets.token_urlsafe(48))
        secret_value = self.session_secret.get_secret_value()
        normalized_secret = secret_value.strip().casefold()
        if len(secret_value.encode("utf-8")) < 32:
            raise ValueError("SESSION_SECRET은 최소 32 bytes 이상이어야 합니다.")
        if any(
            marker in normalized_secret
            for marker in (
                "change-me",
                "changeme",
                "replace-me",
                "example-secret",
                "__generate_",
            )
        ):
            raise ValueError("SESSION_SECRET에 예시용 Placeholder를 사용할 수 없습니다.")
        if self.environment == "production":
            if effective_database_password is None:
                raise ValueError(
                    "운영 Database 연결에는 Password를 반드시 설정해야 합니다."
                )
            normalized_database_password = (
                effective_database_password.strip().casefold()
            )
            if len(effective_database_password.encode("utf-8")) < 16:
                raise ValueError(
                    "운영 Database Password는 최소 16 bytes 이상이어야 합니다."
                )
            if any(
                marker in normalized_database_password
                for marker in (
                    "change-me",
                    "changeme",
                    "replace-me",
                    "example-password",
                    "__generate_",
                )
            ):
                raise ValueError(
                    "운영 Database Password에 예시용 Placeholder를 사용할 수 없습니다."
                )
            if not self.session_cookie_secure:
                raise ValueError("운영 환경 Session Cookie는 Secure여야 합니다.")
            if not self.session_cookie_name.startswith("__Host-"):
                raise ValueError("운영 환경 Session Cookie는 __Host- 접두사를 사용해야 합니다.")
            if not self.csrf_require_origin:
                raise ValueError("운영 환경에서는 CSRF Origin 검사를 끌 수 없습니다.")
        if self.field_encryption_key is None:
            if self.environment == "production":
                raise ValueError(
                    "운영 환경에는 FIELD_ENCRYPTION_KEY를 반드시 설정해야 합니다."
                )
            self.field_encryption_key = SecretStr(secrets.token_urlsafe(48))
        field_encryption_key_value = (
            self.field_encryption_key.get_secret_value()
        )
        if len(field_encryption_key_value.encode("utf-8")) < 32:
            raise ValueError(
                "FIELD_ENCRYPTION_KEY는 최소 32 bytes 이상이어야 합니다."
            )
        normalized_field_key = field_encryption_key_value.strip().casefold()
        if any(
            marker in normalized_field_key
            for marker in (
                "change-me",
                "changeme",
                "replace-me",
                "example-secret",
                "__generate_",
            )
        ):
            raise ValueError(
                "FIELD_ENCRYPTION_KEY에 예시용 Placeholder를 사용할 수 없습니다."
            )
        return self

    @property
    def session_secret_value(self) -> str:
        if self.session_secret is None:
            raise RuntimeError("SESSION_SECRET이 초기화되지 않았습니다.")
        return self.session_secret.get_secret_value()

    @property
    def field_encryption_key_value(self) -> str:
        if self.field_encryption_key is None:
            raise RuntimeError("FIELD_ENCRYPTION_KEY가 초기화되지 않았습니다.")
        return self.field_encryption_key.get_secret_value()


@lru_cache
def get_settings() -> Settings:
    return Settings()
