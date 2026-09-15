from datetime import date, time

import pytest

from app.core.exceptions import ApiError
from app.services.appointments import (
    ScheduleContext,
    base_rule_for,
    procedure_duration,
    validate_standard_morning,
)


def test_procedure_duration_uses_longest_selected_procedure() -> None:
    assert procedure_duration({"UPPER"}) == 30
    assert procedure_duration({"COLON"}) == 60
    assert procedure_duration({"UPPER", "COLON"}) == 60
    assert procedure_duration({"UPPER", "COLON"}, "SET_60") == 60
    assert procedure_duration({"UPPER", "COLON"}, "SET_90") == 90


def test_procedure_set_is_rejected_for_single_procedure() -> None:
    with pytest.raises(ApiError) as captured:
        procedure_duration({"COLON"}, "SET_90")

    assert captured.value.code == "PROCEDURE_SET_INVALID"


def test_sunday_is_closed() -> None:
    with pytest.raises(ApiError) as captured:
        base_rule_for(date(2026, 9, 13))

    assert captured.value.code == "SCHEDULE_CLOSED"


def test_wednesday_colon_must_end_by_eleven() -> None:
    with pytest.raises(ApiError) as captured:
        validate_standard_morning(
            service_date=date(2026, 9, 9),
            start_time=time(10, 30),
            procedure_codes={"COLON"},
            context=ScheduleContext([], 0, 0),
        )

    assert captured.value.code == "END_TIME_EXCEEDED"


def test_start_time_must_use_thirty_minute_grid() -> None:
    with pytest.raises(ApiError) as captured:
        validate_standard_morning(
            service_date=date(2026, 9, 10),
            start_time=time(9, 10),
            procedure_codes={"UPPER"},
            context=ScheduleContext([], 0, 0),
        )

    assert captured.value.code == "TIME_GRID_INVALID"
