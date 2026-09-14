from __future__ import annotations

from datetime import date

import pytest

from app.core.exceptions import ApiError
from app.services.patients import calculate_age, normalize_chart_number


def test_chart_number_normalization_preserves_leading_zero() -> None:
    display, normalized = normalize_chart_number(" 0012-a ")

    assert display == "0012-a"
    assert normalized == "0012-a"


def test_screening_age_uses_service_year_minus_birth_year() -> None:
    assert (
        calculate_age(
            date(1980, 12, 31),
            date(2026, 1, 1),
            "SCREENING_YEAR_AGE",
        )
        == 46
    )


def test_full_age_changes_on_birthday() -> None:
    birth_date = date(1980, 7, 31)

    assert calculate_age(birth_date, date(2026, 7, 30), "FULL_AGE") == 45
    assert calculate_age(birth_date, date(2026, 7, 31), "FULL_AGE") == 46


def test_february_29_full_age_changes_on_march_first_in_non_leap_year() -> None:
    birth_date = date(2000, 2, 29)

    assert calculate_age(birth_date, date(2025, 2, 28), "FULL_AGE") == 24
    assert calculate_age(birth_date, date(2025, 3, 1), "FULL_AGE") == 25


def test_age_reference_date_cannot_precede_birth_date() -> None:
    with pytest.raises(ApiError) as exc_info:
        calculate_age(
            date(2026, 1, 1),
            date(2025, 12, 31),
            "FULL_AGE",
        )

    assert exc_info.value.code == "AGE_CALCULATION_INVALID"
