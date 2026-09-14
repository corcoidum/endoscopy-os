from __future__ import annotations

import argparse
import os
import re
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import hash_password, normalize_login_id
from app.db.session import get_session_factory
from app.models import (
    Permission,
    Role,
    RolePermission,
    ScheduleResource,
    StaffProfile,
    User,
    UserRole,
)


PERMISSIONS: dict[str, str] = {
    "appointment.read": "일정과 예약 조회",
    "appointment.create": "예약 생성",
    "appointment.update": "예약 변경",
    "appointment.cancel": "예약 취소",
    "appointment.no_show": "No-show 기록",
    "patient.read": "환자 조회",
    "patient.create": "환자 등록",
    "patient.update": "환자정보 변경",
    "verification.secondary": "인적사항 2차 확인",
    "verification.pacs": "PACS 입력 확인",
    "procedure.write": "검사 진행과 완료 기록",
    "pathology.read": "조직검사 관리대장 조회",
    "pathology.write": "조직검사와 Follow-up 기록",
    "schedule_override.approve": "일정 예외 승인",
    "medication_master.manage": "약제 Master 관리",
    "identity.manage": "사용자와 역할 관리",
    "audit.read": "감사로그 조회",
    "backup.read": "Backup 상태 조회",
    "backup.run": "수동 Backup 실행",
}

ROLE_DEFINITIONS: dict[str, tuple[str, set[str]]] = {
    "ADMIN": ("관리자", set(PERMISSIONS)),
    "FRONT_DESK": (
        "원무 담당자",
        {
            "appointment.read",
            "appointment.create",
            "appointment.update",
            "appointment.cancel",
            "appointment.no_show",
            "patient.read",
            "patient.create",
            "patient.update",
        },
    ),
    "ENDOSCOPY_STAFF": (
        "내시경 담당자",
        {
            "appointment.read",
            "patient.read",
            "verification.secondary",
            "verification.pacs",
            "procedure.write",
            "pathology.read",
            "pathology.write",
        },
    ),
    "READ_ONLY": (
        "조회 전용",
        {
            "appointment.read",
            "patient.read",
        },
    ),
}

LOGIN_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{3,80}$")


def seed_schedule_resource(db: Session) -> ScheduleResource:
    resource = db.scalar(
        select(ScheduleResource).where(
            ScheduleResource.code == "ENDOSCOPY_MAIN"
        )
    )
    if resource is None:
        resource = ScheduleResource(
            code="ENDOSCOPY_MAIN",
            name="내시경 공용 일정",
            is_active=True,
        )
        db.add(resource)
    else:
        resource.name = "내시경 공용 일정"
        resource.is_active = True
    db.flush()
    return resource


def seed_roles_and_permissions(db: Session) -> dict[str, Role]:
    permission_by_code = {
        permission.code: permission
        for permission in db.scalars(select(Permission)).all()
    }
    for code, description in PERMISSIONS.items():
        permission = permission_by_code.get(code)
        if permission is None:
            permission = Permission(code=code, description_ko=description)
            db.add(permission)
            permission_by_code[code] = permission
        else:
            permission.description_ko = description

    role_by_code = {
        role.code: role
        for role in db.scalars(
            select(Role).options(
                selectinload(Role.permission_assignments).selectinload(
                    RolePermission.permission
                )
            )
        ).all()
    }
    for code, (name_ko, permission_codes) in ROLE_DEFINITIONS.items():
        role = role_by_code.get(code)
        if role is None:
            role = Role(code=code, name_ko=name_ko, is_active=True)
            db.add(role)
            role_by_code[code] = role
        else:
            role.name_ko = name_ko

        assigned_codes = {
            assignment.permission.code
            for assignment in role.permission_assignments
        }
        role.permission_assignments[:] = [
            assignment
            for assignment in role.permission_assignments
            if assignment.permission.code in permission_codes
        ]
        for permission_code in sorted(permission_codes - assigned_codes):
            role.permission_assignments.append(
                RolePermission(permission=permission_by_code[permission_code])
            )

    db.flush()
    return role_by_code


def _validate_admin_input(login_id: str, display_name: str, password: str) -> None:
    if not LOGIN_ID_PATTERN.fullmatch(login_id):
        raise ValueError(
            "관리자 ID는 영문, 숫자, 점, 밑줄, 하이픈으로 3~80자여야 합니다."
        )
    if not display_name.strip():
        raise ValueError("관리자 표시 이름을 입력해야 합니다.")
    if not 12 <= len(password) <= 128:
        raise ValueError("관리자 Password는 12~128자여야 합니다.")
    normalized_password = password.strip().casefold()
    if "__generate_" in normalized_password or "change-me" in normalized_password:
        raise ValueError("예시용 Password는 사용할 수 없습니다.")


def bootstrap_admin(
    db: Session,
    *,
    login_id: str,
    display_name: str,
    password: str,
    admin_role: Role,
) -> tuple[User, bool]:
    _validate_admin_input(login_id, display_name, password)
    normalized_login_id = normalize_login_id(login_id)
    existing_admin = db.scalar(
        select(User)
        .join(UserRole)
        .join(Role)
        .where(
            Role.code == "ADMIN",
            User.is_active.is_(True),
        )
    )
    existing_user = db.scalar(
        select(User)
        .where(User.login_id_normalized == normalized_login_id)
        .options(
            selectinload(User.role_assignments).selectinload(UserRole.role)
        )
    )

    if existing_user is not None:
        if not existing_user.is_active:
            raise ValueError(
                "동일 ID의 비활성 계정이 있습니다. 자동으로 재활성화하지 않습니다."
            )
        if all(
            assignment.role.code != "ADMIN"
            for assignment in existing_user.role_assignments
        ):
            if existing_admin is not None:
                raise ValueError(
                    "활성 관리자 계정이 이미 있습니다. 사용자 관리 화면에서 역할을 지정하세요."
                )
            existing_user.role_assignments.append(UserRole(role=admin_role))
        return existing_user, False

    if existing_admin is not None:
        raise ValueError(
            "활성 관리자 계정이 이미 있습니다. 추가 계정은 사용자 관리 화면에서 등록하세요."
        )

    profile = StaffProfile(
        display_name=display_name.strip(),
        staff_type="ADMINISTRATIVE",
        is_active=True,
    )
    user = User(
        login_id_normalized=normalized_login_id,
        password_hash=hash_password(password),
        display_name=display_name.strip(),
        staff_profile=profile,
        is_active=True,
        must_change_password=True,
    )
    user.role_assignments = [UserRole(role=admin_role)]
    db.add(user)
    db.flush()
    return user, True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="기본 Role/Permission과 최초 관리자 계정을 생성합니다."
    )
    parser.add_argument(
        "--admin-id",
        default=os.getenv("BOOTSTRAP_ADMIN_LOGIN_ID", ""),
        help="최초 관리자 로그인 ID",
    )
    parser.add_argument(
        "--admin-name",
        default=os.getenv("BOOTSTRAP_ADMIN_DISPLAY_NAME", ""),
        help="최초 관리자 표시 이름",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not args.admin_id or not args.admin_name or not password:
        raise SystemExit(
            "BOOTSTRAP_ADMIN_LOGIN_ID, BOOTSTRAP_ADMIN_DISPLAY_NAME, "
            "BOOTSTRAP_ADMIN_PASSWORD를 모두 설정해야 합니다."
        )

    with get_session_factory()() as db:
        try:
            roles = seed_roles_and_permissions(db)
            seed_schedule_resource(db)
            user, created = bootstrap_admin(
                db,
                login_id=args.admin_id,
                display_name=args.admin_name,
                password=password,
                admin_role=roles["ADMIN"],
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

    action = "생성" if created else "확인"
    print(f"기본 Role/Permission과 관리자 계정을 안전하게 {action}했습니다.")
    print(f"관리자 ID: {user.login_id_normalized}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
