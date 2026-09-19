"""운영자가 직접 실행하는 제한된 관리 명령."""

from __future__ import annotations

from app.core.config import Settings


def reject_production_environment(settings: Settings, command: str) -> None:
    """합성 Seed가 운영 Database에 들어가는 것을 막는다.

    운영 `.env`가 열린 Shell에서 무심코 실행하면 합성 환자·예약이 그대로 저장되고,
    진료 기록과 섞이면 되돌리기 어렵다.
    """

    if settings.environment == "production":
        raise SystemExit(
            f"APP_ENV=production에서는 {command}를 실행할 수 없습니다. "
            "합성 Seed는 개발·시험 Database에서만 사용해 주세요."
        )
