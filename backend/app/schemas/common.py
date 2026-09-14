from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    code: str
    message: str
    field_errors: list[dict[str, Any]] | None = None


class HealthResponse(BaseModel):
    status: str
    service: str


class MessageResponse(BaseModel):
    message: str


class PaginationResponse(BaseModel):
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
