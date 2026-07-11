#!/bin/sh
# Container entrypoint: best-effort pre-migration DB dump, then apply
# migrations (must succeed), then start the server.
set -e

BACKUP_DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$BACKUP_DIR"

# Wait (briefly) for Postgres to accept connections. Best-effort and
# time-bounded — the app may start before the db container is ready,
# but we never want to hang startup indefinitely.
if [ -n "$DATABASE_URL" ]; then
  i=0
  while [ "$i" -lt 10 ]; do
    if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done

  dump_file="$BACKUP_DIR/pre-migrate-$(date +%Y%m%d-%H%M%S).sql"
  if ! pg_dump "$DATABASE_URL" --no-owner --no-privileges > "$dump_file"; then
    echo "[entrypoint] pre-migration dump skipped/failed (ok on first boot)"
  fi
else
  echo "[entrypoint] DATABASE_URL not set; skipping pre-migration dump"
fi

# Migrations must succeed — do not start the server on a broken schema.
npm run db:migrate

exec node server/dist/index.js
