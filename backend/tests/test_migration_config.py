from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_alembic_accepts_url_encoded_database_password() -> None:
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "test",
            "DATABASE_URL": (
                "postgresql+psycopg://migration:"
                "slash%2Fpercent%25@localhost/clinic_endoscopy"
            ),
        }
    )

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "upgrade",
            "head",
            "--sql",
        ],
        cwd=PROJECT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )

    assert completed.returncode == 0, completed.stderr
    assert "CREATE TABLE iam.users" in completed.stdout
    assert "CREATE TABLE patients" in completed.stdout
    assert "CREATE TABLE patient_history_events" in completed.stdout
    assert "CREATE TABLE appointments" in completed.stdout
    assert "ex_appointments_resource_time_no_overlap" in completed.stdout
