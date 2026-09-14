from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from collections.abc import Sequence


IAM_SCHEMA = "iam"


class StaffProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "staff_profiles"
    __table_args__ = (
        CheckConstraint(
            "staff_type IN ('DOCTOR','NURSE','ASSISTANT','ADMINISTRATIVE','OTHER')",
            name="staff_type",
        ),
        {"schema": IAM_SCHEMA},
    )

    display_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    staff_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    employee_code: Mapped[str | None] = mapped_column(
        String(40), nullable=True, unique=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true"), index=True
    )
    deactivated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped[User | None] = relationship(back_populates="staff_profile")


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("failed_login_count >= 0", name="failed_login_nonnegative"),
        {"schema": IAM_SCHEMA},
    )

    login_id_normalized: Mapped[str] = mapped_column(
        String(80), nullable=False, unique=True, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    staff_profile_id: Mapped[UUID | None] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.staff_profiles.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true"), index=True
    )
    failed_login_count: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default=text("0")
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    must_change_password: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )

    staff_profile: Mapped[StaffProfile | None] = relationship(back_populates="user")
    role_assignments: Mapped[list[UserRole]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list[UserSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def active_role_codes(self, now: datetime) -> set[str]:
        return {
            assignment.role.code
            for assignment in self.role_assignments
            if assignment.role.is_active
            and (assignment.valid_until is None or assignment.valid_until > now)
        }

    def active_permission_codes(self, now: datetime) -> set[str]:
        permissions: set[str] = set()
        for assignment in self.role_assignments:
            if (
                not assignment.role.is_active
                or (
                    assignment.valid_until is not None
                    and assignment.valid_until <= now
                )
            ):
                continue
            permissions.update(
                permission_assignment.permission.code
                for permission_assignment in assignment.role.permission_assignments
            )
        return permissions


class Role(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "roles"
    __table_args__ = {"schema": IAM_SCHEMA}

    code: Mapped[str] = mapped_column(
        String(40), nullable=False, unique=True, index=True
    )
    name_ko: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true"), index=True
    )

    user_assignments: Mapped[list[UserRole]] = relationship(back_populates="role")
    permission_assignments: Mapped[list[RolePermission]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )


class Permission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "permissions"
    __table_args__ = {"schema": IAM_SCHEMA}

    code: Mapped[str] = mapped_column(
        String(80), nullable=False, unique=True, index=True
    )
    description_ko: Mapped[str] = mapped_column(String(200), nullable=False)

    role_assignments: Mapped[list[RolePermission]] = relationship(
        back_populates="permission"
    )


class UserRole(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
        Index("ix_user_roles_valid_until", "valid_until"),
        {"schema": IAM_SCHEMA},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.roles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    valid_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped[User] = relationship(back_populates="role_assignments")
    role: Mapped[Role] = relationship(back_populates="user_assignments")


class RolePermission(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint(
            "role_id", "permission_id", name="uq_role_permissions_role_permission"
        ),
        {"schema": IAM_SCHEMA},
    )

    role_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    permission_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.permissions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    role: Mapped[Role] = relationship(back_populates="permission_assignments")
    permission: Mapped[Permission] = relationship(back_populates="role_assignments")


class UserSession(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "user_sessions"
    __table_args__ = {"schema": IAM_SCHEMA}

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey(f"{IAM_SCHEMA}.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    csrf_secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_ip: Mapped[str] = mapped_column(
        String(45).with_variant(INET(), "postgresql"), nullable=False, index=True
    )
    user_agent_summary: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    idle_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    absolute_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    revoke_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


def role_codes(assignments: Sequence[UserRole]) -> list[str]:
    return sorted({assignment.role.code for assignment in assignments})
