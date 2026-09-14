from fastapi import APIRouter

from app.api.routers import appointments, auth, patients, users


api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(patients.router)
api_router.include_router(appointments.router)
