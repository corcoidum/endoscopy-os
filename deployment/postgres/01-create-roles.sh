#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_MIGRATION_USER:?POSTGRES_MIGRATION_USER is required}"
: "${POSTGRES_MIGRATION_PASSWORD:?POSTGRES_MIGRATION_PASSWORD is required}"
: "${POSTGRES_APP_USER:?POSTGRES_APP_USER is required}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}"

# 이 Script는 빈 PostgreSQL Data Volume의 최초 초기화 때 한 번만 실행된다.
# Identifier와 Password는 psql 변수 및 PostgreSQL format()으로 안전하게 인용한다.
psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=database_name="$POSTGRES_DB" \
  --set=migration_user="$POSTGRES_MIGRATION_USER" \
  --set=migration_password="$POSTGRES_MIGRATION_PASSWORD" \
  --set=app_user="$POSTGRES_APP_USER" \
  --set=app_password="$POSTGRES_APP_PASSWORD" <<'EOSQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'migration_user',
  :'migration_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'migration_user'
)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  :'app_user',
  :'app_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_user'
)
\gexec

ALTER DATABASE :"database_name" OWNER TO :"migration_user";
ALTER SCHEMA public OWNER TO :"migration_user";
CREATE SCHEMA IF NOT EXISTS iam AUTHORIZATION :"migration_user";
ALTER SCHEMA iam OWNER TO :"migration_user";

GRANT CONNECT ON DATABASE :"database_name" TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT USAGE ON SCHEMA iam TO :"app_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT USAGE ON TYPES TO :"app_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA iam
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA iam
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA iam
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA iam
  GRANT USAGE ON TYPES TO :"app_user";
EOSQL
