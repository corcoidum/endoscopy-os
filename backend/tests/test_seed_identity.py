from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.cli.seed_identity import (
    PERMISSIONS,
    ROLE_DEFINITIONS,
    bootstrap_admin,
    seed_roles_and_permissions,
)
from app.core.security import verify_password
from app.models import Permission, Role, RolePermission, User


def test_identity_seed_is_idempotent(
    session_factory: sessionmaker[Session],
) -> None:
    password = "Synthetic-Bootstrap-Password-42!"

    with session_factory() as db:
        roles = seed_roles_and_permissions(db)
        user, created = bootstrap_admin(
            db,
            login_id="bootstrap.admin",
            display_name="합성 관리자",
            password=password,
            admin_role=roles["ADMIN"],
        )
        db.commit()
        assert created is True
        assert verify_password(password, user.password_hash)
        assert user.must_change_password is True

    with session_factory() as db:
        roles = seed_roles_and_permissions(db)
        _, created = bootstrap_admin(
            db,
            login_id="bootstrap.admin",
            display_name="합성 관리자",
            password=password,
            admin_role=roles["ADMIN"],
        )
        db.commit()

        assert created is False
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(Role)) == len(
            ROLE_DEFINITIONS
        )
        assert db.scalar(select(func.count()).select_from(Permission)) == len(
            PERMISSIONS
        )


def test_identity_seed_removes_obsolete_builtin_role_permission(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as db:
        roles = seed_roles_and_permissions(db)
        obsolete_permission = Permission(
            code="obsolete.permission",
            description_ko="삭제 대상 합성 Permission",
        )
        roles["ADMIN"].permission_assignments.append(
            RolePermission(permission=obsolete_permission)
        )
        db.commit()

    with session_factory() as db:
        roles = seed_roles_and_permissions(db)
        db.commit()

        admin_permission_codes = {
            assignment.permission.code
            for assignment in roles["ADMIN"].permission_assignments
        }
        assert admin_permission_codes == ROLE_DEFINITIONS["ADMIN"][1]
        assert "obsolete.permission" not in admin_permission_codes
