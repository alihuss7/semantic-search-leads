#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

db_connects() {
  local user="$1"
  local password="$2"
  local db_name="$3"
  docker compose -f "$COMPOSE_FILE" exec -T db \
    env PGCONNECT_TIMEOUT=2 \
    env PGPASSWORD="$password" \
    psql -h 127.0.0.1 -U "$user" -d "$db_name" -Atqc "SELECT 1" >/dev/null 2>&1
}

db_process_ready() {
  docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1
}

wait_for_db_auth() {
  local user="$1"
  local password="$2"
  local db_name="$3"
  local max_attempts="${4:-20}"
  local attempts=0
  while [ "$attempts" -lt "$max_attempts" ]; do
    if db_connects "$user" "$password" "$db_name"; then
      return 0
    fi
    attempts=$((attempts + 1))
    if [ $((attempts % 5)) -eq 0 ]; then
      echo "Still waiting for auth as '$user' (${attempts}/${max_attempts})..."
    fi
    sleep 1
  done
  return 1
}

wait_for_db_process() {
  local max_attempts="${1:-60}"
  local attempts=0
  while [ "$attempts" -lt "$max_attempts" ]; do
    if db_process_ready; then
      return 0
    fi
    attempts=$((attempts + 1))
    if [ $((attempts % 5)) -eq 0 ]; then
      echo "PostgreSQL process not ready yet (${attempts}/${max_attempts})..."
    fi
    sleep 1
  done
  return 1
}

check_backend_db_url() {
  local runtime_url="$1"
  DATABASE_URL_TO_TEST="$runtime_url" "$ROOT_DIR/backend/.venv/bin/python" - <<'PY'
import asyncio
import os
import sys

import asyncpg

url = os.environ["DATABASE_URL_TO_TEST"].strip()
if url.startswith("postgresql+asyncpg://"):
    url = "postgresql://" + url[len("postgresql+asyncpg://"):]


async def main() -> None:
    conn = await asyncpg.connect(url, timeout=5)
    try:
        await conn.fetchval("SELECT 1")
    finally:
        await conn.close()


try:
    asyncio.run(main())
except Exception as exc:  # noqa: BLE001
    print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
    raise SystemExit(1)
PY
}

echo "Checking prerequisites..."
require_cmd docker
require_cmd python3
require_cmd npm

if [ ! -f "$ROOT_DIR/backend/.env" ]; then
  echo "Missing backend/.env"
  echo "Create it first (see README.md)."
  exit 1
fi

ENV_DB_URL="$(grep -E '^DATABASE_URL=' "$ROOT_DIR/backend/.env" | head -n 1 | cut -d= -f2- || true)"
if [ -z "$ENV_DB_URL" ]; then
  echo "Missing DATABASE_URL in backend/.env"
  exit 1
fi

PARSED_DB_ENV="$(ENV_DB_URL="$ENV_DB_URL" python3 - <<'PY'
import os
import sys
import signal
import shlex
from urllib.parse import urlparse

signal.signal(signal.SIGPIPE, signal.SIG_DFL)

raw = os.environ["ENV_DB_URL"].strip()
if raw.startswith("postgresql+asyncpg://"):
    raw = "postgresql://" + raw[len("postgresql+asyncpg://"):]

p = urlparse(raw)
user = p.username or ""
password = p.password or ""
db_name = p.path.lstrip("/")

if p.scheme != "postgresql" or not user or not db_name:
    sys.exit(1)

print("DB_USER=" + shlex.quote(user))
print("DB_PASSWORD=" + shlex.quote(password))
print("DB_NAME=" + shlex.quote(db_name))
print("DB_HOST=" + shlex.quote(p.hostname or "127.0.0.1"))
print("DB_PORT=" + shlex.quote(str(p.port or 5433)))
PY
)" || {
  echo "Could not parse DATABASE_URL in backend/.env"
  echo "Expected format: postgresql+asyncpg://<user>:<password>@<host>:<port>/<database>"
  exit 1
}

eval "$PARSED_DB_ENV"
ACTIVE_DB_USER="$DB_USER"
ACTIVE_DB_PASSWORD="$DB_PASSWORD"
RUNTIME_DB_URL="$ENV_DB_URL"
FALLBACK_IN_USE=0

echo "Starting PostgreSQL..."
docker compose -f "$COMPOSE_FILE" up -d db

echo "Waiting for PostgreSQL server process..."
if ! wait_for_db_process 60; then
  echo "PostgreSQL server did not become ready in time."
  docker compose -f "$COMPOSE_FILE" logs --tail=80 db || true
  exit 1
fi

echo "Validating database credentials..."
if ! wait_for_db_auth "$ACTIVE_DB_USER" "$ACTIVE_DB_PASSWORD" "$DB_NAME" 12; then
  if [ "$DB_USER" != "postgres" ]; then
    echo "Could not authenticate with DATABASE_URL user '$DB_USER'."
    echo "Trying docker default role 'postgres'..."
    ACTIVE_DB_USER="postgres"
    ACTIVE_DB_PASSWORD="password"
    if ! wait_for_db_auth "$ACTIVE_DB_USER" "$ACTIVE_DB_PASSWORD" "$DB_NAME" 12; then
      echo "PostgreSQL is running but authentication failed for both '$DB_USER' and 'postgres'."
      echo "Update backend/.env DATABASE_URL or reset Docker volume: docker compose down -v"
      docker compose -f "$COMPOSE_FILE" logs --tail=80 db || true
      exit 1
    fi
    RUNTIME_DB_URL="postgresql+asyncpg://${ACTIVE_DB_USER}:${ACTIVE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    FALLBACK_IN_USE=1
    echo "Warning: using fallback DATABASE_URL for this run:"
    echo "  $RUNTIME_DB_URL"
    echo "Consider updating backend/.env to match."
  else
    echo "Could not authenticate to PostgreSQL with user '$DB_USER'."
    echo "Try resetting Docker volume: docker compose down -v"
    exit 1
  fi
fi

echo "Applying schema..."
cat "$ROOT_DIR/schema.sql" | docker compose -f "$COMPOSE_FILE" exec -T db env PGPASSWORD="$ACTIVE_DB_PASSWORD" psql -h 127.0.0.1 -U "$ACTIVE_DB_USER" -d "$DB_NAME" >/dev/null

if [ ! -d "$ROOT_DIR/backend/.venv" ]; then
  echo "Creating backend virtualenv..."
  python3 -m venv "$ROOT_DIR/backend/.venv"
fi

BACKEND_REQUIREMENTS="$ROOT_DIR/backend/requirements.txt"
BACKEND_STAMP="$ROOT_DIR/backend/.venv/.requirements-installed"
if [ ! -f "$BACKEND_STAMP" ] || [ "$BACKEND_REQUIREMENTS" -nt "$BACKEND_STAMP" ]; then
  echo "Installing backend dependencies..."
  "$ROOT_DIR/backend/.venv/bin/pip" install -r "$BACKEND_REQUIREMENTS"
  touch "$BACKEND_STAMP"
else
  echo "Backend dependencies are up to date."
fi

FRONTEND_LOCKFILE="$ROOT_DIR/frontend/package-lock.json"
FRONTEND_STAMP="$ROOT_DIR/frontend/node_modules/.package-lock-installed"
if [ ! -d "$ROOT_DIR/frontend/node_modules" ] || [ ! -f "$FRONTEND_STAMP" ] || [ "$FRONTEND_LOCKFILE" -nt "$FRONTEND_STAMP" ]; then
  echo "Installing frontend dependencies..."
  (
    cd "$ROOT_DIR/frontend"
    npm install
    touch "$FRONTEND_STAMP"
  )
else
  echo "Frontend dependencies are up to date."
fi

echo "Validating backend connection URL..."
if ! check_backend_db_url "$RUNTIME_DB_URL"; then
  echo "Backend could not connect using DATABASE_URL:"
  echo "  $RUNTIME_DB_URL"
  if [ "$FALLBACK_IN_USE" -eq 1 ]; then
    echo "Fallback credentials worked inside the DB container, but failed from the backend process."
  fi
  echo "This usually means backend/.env points to a different PostgreSQL server than Docker."
  echo "Recommended fix:"
  echo "  1) Set backend/.env DATABASE_URL to postgresql+asyncpg://postgres:password@127.0.0.1:5433/${DB_NAME}"
  echo "  2) Reset DB volume once: docker compose down -v"
  echo "  3) Run ./start.sh again"
  exit 1
fi

cleanup() {
  echo
  echo "Stopping app processes..."
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
  wait "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Starting backend on http://localhost:8000 ..."
(
  cd "$ROOT_DIR/backend"
  exec env -u DATABASE_URL DATABASE_URL="$RUNTIME_DB_URL" "$ROOT_DIR/backend/.venv/bin/python" -m uvicorn main:app --port 8000
) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:3000 ..."
(
  cd "$ROOT_DIR/frontend"
  exec npm run dev
) &
FRONTEND_PID=$!

echo "App is running. Press Ctrl+C to stop."

# macOS ships Bash 3.2, which does not support `wait -n`.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
