"""원내 기준 시각(서울) Helper.

Server Timezone이나 DB Session Timezone과 무관하게 같은 값을 돌려준다.
일정·환자 등 여러 Service가 함께 쓰므로 Service가 아닌 core에 둔다.
"""

from __future__ import annotationsfrom datetime import UTC, date, datetimefrom zoneinfo import ZoneInfoSEOUL = ZoneInfo("Asia/Seoul")


def to_seoul(value: datetime) -> datetime:
    """DB Session Timezone과 무관하게 예약 시각을 서울 기준 벽시계로 맞춘다.

    SQLite는 저장 시 Offset을 버리고 서울 벽시계 값을 그대로 돌려주며,
    PostgreSQL은 Session Timezone(UTC 등) 기준으로 돌려줄 수 있다.
    """

    if value.tzinfo is None:
        return value.replace(tzinfo=SEOUL)
    return value.astimezone(SEOUL)


def today_in_seoul(now: datetime | None = None) -> date:
    """Server Timezone과 무관하게 서울 기준 오늘 날짜를 돌려준다."""

    return (now or datetime.now(UTC)).astimezone(SEOUL).date()
