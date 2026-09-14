"""Import every model here so Alembic sees complete Base.metadata."""

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
from app.models.appointment import (
    Appointment,
    AppointmentHistoryEvent,
    AppointmentProcedure,
    ScheduleResource,
)
from app.models.patient import Patient, PatientHistoryEvent

__all__ = [
    "IAM_SCHEMA",
    "Permission",
    "Role",
    "RolePermission",
    "StaffProfile",
    "User",
    "UserRole",
    "UserSession",
    "Appointment",
    "AppointmentHistoryEvent",
    "AppointmentProcedure",
    "ScheduleResource",
    "Patient",
    "PatientHistoryEvent",
]
