# Database Migration

운영 Migration은 Repository Root에서 Docker Compose의 Migration 전용 계정으로
실행합니다.

```powershell
docker compose run --rm migrate
```

Local Python으로 직접 실행할 때는 `DATABASE_URL`을 Migration 전용 계정으로
명시한 뒤 다음 명령을 사용합니다.

```powershell
.\backend\.venv\Scripts\alembic.exe upgrade head
```

- 운영 Database Schema 변경은 Migration으로만 수행합니다.
- 생성된 Migration은 자동생성 결과를 그대로 사용하지 않고 Constraint와
  Downgrade 위험을 검토합니다.
- Runtime 계정으로 Migration을 실행하지 않습니다.
- 실제 Database URL과 Password는 Repository에 저장하지 않습니다.
