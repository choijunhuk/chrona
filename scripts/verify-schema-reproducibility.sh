#!/bin/bash
# Stage 1 DoD 1 검증: public 스키마 전체 드랍 → 마이그레이션 재적용 → 테이블 확인
# 운영 데이터 생기면 절대 실행 금지. 비밀값은 .env.local (SUPABASE_DB_PASSWORD).
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; source .env.local; set +a
export PGPASSWORD="${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD not set in .env.local}"
ENC_PW=$(node -e "console.log(encodeURIComponent(process.env.PGPASSWORD))")

PSQL=/opt/homebrew/opt/libpq/bin/psql
HOST=aws-0-ap-northeast-2.pooler.supabase.com
USER=postgres.jhwleoidvzxkdbylweqx

echo "== 1. 스키마 드랍"
# 아래 grant는 Supabase 스톡 초기화와 동일한 복원이다 (drop schema가 날린 것 재생성).
# Supabase에서 접근 제어 경계는 grant가 아니라 RLS — 전 테이블 RLS ON (0002_rls.sql).
$PSQL -h $HOST -p 5432 -U $USER -d postgres -v ON_ERROR_STOP=1 <<'SQL'
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
drop trigger if exists on_auth_user_created on auth.users;
delete from supabase_migrations.schema_migrations;
SQL

echo "== 2. 마이그레이션 재적용"
supabase db push --db-url "postgresql://$USER:$ENC_PW@$HOST:5432/postgres"

echo "== 3. 결과 확인"
$PSQL -h $HOST -p 5432 -U $USER -d postgres -c \
  "select table_name from information_schema.tables where table_schema='public' order by 1;"
$PSQL -h $HOST -p 5432 -U $USER -d postgres -c \
  "select tablename, rowsecurity from pg_tables where schemaname='public' order by 1;"
echo "== 완료: 테이블 9개 + 전부 rowsecurity=t 이면 통과"
