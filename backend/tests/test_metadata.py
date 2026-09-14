from app.db.base import Base


def test_alembic_metadata_contains_complete_iam_model_set() -> None:
    expected_tables = {
        "iam.staff_profiles",
        "iam.users",
        "iam.roles",
        "iam.permissions",
        "iam.user_roles",
        "iam.role_permissions",
        "iam.user_sessions",
        "patients",
        "patient_history_events",
        "schedule_resources",
        "appointments",
        "appointment_procedures",
        "appointment_history_events",
    }

    assert expected_tables.issubset(set(Base.metadata.tables))
    users_table = Base.metadata.tables["iam.users"]
    assert "must_change_password" in users_table.c
    assert users_table.c.must_change_password.nullable is False
    patients_table = Base.metadata.tables["patients"]
    assert "age" not in patients_table.c
    assert "phone_ciphertext" in patients_table.c
    assert "special_notes_ciphertext" in patients_table.c
