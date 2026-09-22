"""Import every model here so Alembic sees complete Base.metadata."""

from app.models.appointment import (
    Appointment,
    AppointmentHistoryEvent,
    AppointmentProcedure,
    ScheduleAdditionalSlot,
    ScheduleDateOverride,
    ScheduleResource,
)
from app.models.iam import (
    IAM_SCHEMA,
    Permission,
    Role,
    RolePermission,
    StaffProfile,
    User,
    UserRole,
    UserSession,
)
from app.models.patient import Patient, PatientHistoryEvent
from app.models.verification import PatientVerification

__all__ = [
    "IAM_SCHEMA",
    "Appointment",
    "AppointmentHistoryEvent",
    "AppointmentProcedure",
    "Patient",
    "PatientHistoryEvent",
    "PatientVerification",
    "Permission",
    "Role",
    "RolePermission",
    "ScheduleAdditionalSlot",
    "ScheduleDateOverride",
    "ScheduleResource",
    "StaffProfile",
    "User",
    "UserRole",
    "UserSession",
]
