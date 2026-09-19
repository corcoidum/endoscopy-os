from __future__ import annotations

from app.core.clock import to_seoul
from app.models import ScheduleDateOverride
from app.schemas.schedule import (
    DayPolicyResponse,
    ImpactedAppointmentResponse,
    ScheduleOverrideDecisionResponse,
    ScheduleOverrideResponse,
)
from app.services.appointments import (
    PolicyConflict,
    ResolvedDayPolicy,
    minutes_to_time,
)


def present_override(override: ScheduleDateOverride) -> ScheduleOverrideResponse:
    return ScheduleOverrideResponse.model_validate(override)


def present_conflict(conflict: PolicyConflict) -> ImpactedAppointmentResponse:
    appointment = conflict.appointment
    return ImpactedAppointmentResponse(
        id=appointment.id,
        start_time=to_seoul(appointment.scheduled_start_at).time().replace(tzinfo=None),
        end_time=to_seoul(appointment.scheduled_end_at).time().replace(tzinfo=None),
        booking_bucket=appointment.booking_bucket,
        procedures=sorted(
            item.procedure_code for item in appointment.procedures
        ),
        issue=conflict.issue,
    )


def present_decision(
    override: ScheduleDateOverride, conflicts: list[PolicyConflict]
) -> ScheduleOverrideDecisionResponse:
    return ScheduleOverrideDecisionResponse(
        override=present_override(override),
        impacted_appointments=[present_conflict(item) for item in conflicts],
    )


def present_day_policy(policy: ResolvedDayPolicy) -> DayPolicyResponse:
    morning = policy.morning
    return DayPolicyResponse(
        service_date=policy.service_date,
        closed=policy.closed,
        morning_start_time=minutes_to_time(morning.start_minute) if morning else None,
        morning_end_time=minutes_to_time(morning.end_minute) if morning else None,
        upper_capacity=morning.upper_capacity if morning else None,
        colon_capacity=morning.colon_capacity if morning else None,
        afternoon_allowed=policy.afternoon_allowed,
        schedule_policy_version=policy.policy_version,
    )
