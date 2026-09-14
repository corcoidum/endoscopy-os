# PostgreSQL Container 초기화

`01-create-roles.sh`는 빈 `postgres_data` Volume이 처음 생성될 때만 실행됩니다.
Compose는 PostgreSQL 16의 검증된 Patch Version인 `postgres:16.14-alpine`을
고정해 사용합니다.

- `POSTGRES_ADMIN_USER`: Container 초기화용 관리자
- `POSTGRES_MIGRATION_USER`: Alembic DDL 및 Schema 소유자
- `POSTGRES_APP_USER`: FastAPI Runtime의 제한된 DML 계정

초기화 Script는 Migration 계정을 `public`과 `iam` Schema의 소유자로 만들고,
Runtime 계정에는 두 Schema의 `USAGE` 및 Migration 계정이 이후 생성하는
Table·Sequence·Function·Type에 필요한 최소 권한을 부여합니다. 따라서 IAM
Table을 Application 계정이 사용할 수 있지만 DDL 권한은 갖지 않습니다.

비밀번호나 Role 이름을 `.env`에서 바꿔도 기존 Data Volume에는 자동 반영되지
않습니다. 운영 Data Volume을 삭제해서 다시 초기화하지 말고, 승인된 별도
비밀번호 Rotation 절차를 사용해야 합니다.

PostgreSQL `5432`는 Compose에서 `ports`로 Publish하지 않습니다.
