from fastapi import APIRouter

from app.api.routers import (
    appointments,
    auth,
    medications,
    patients,
    schedule,
    staff_profiles,
    users,
    verifications,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(patients.router)
api_router.include_router(appointments.router)
api_router.include_router(schedule.router)
api_router.include_router(verifications.router)
api_router.include_router(medications.router)
api_router.include_router(staff_profiles.router)
