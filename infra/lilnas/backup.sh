#!/bin/sh
# Buddy DB backup -> NAS storage pool.
# Version-matched: dumps via the db container's OWN pg_dump, which always
# matches the Postgres server major version (the app image's client may not).
# Optional first arg is a filename prefix (default "nightly"); only "nightly-"
# dumps are pruned to the most recent 30. Used by the nightly cron and by
# deploy-lilnas.ps1 (as "pre-deploy-<sha>") for a pre-migration snapshot.
set -e

PREFIX="${1:-nightly}"
. /srv/buddy/.env
BDIR="${BUDDY_DATA_DIR}/backups"

docker exec buddy-db pg_dump -U buddy --no-owner --no-privileges buddy \
  > "$BDIR/${PREFIX}-$(date +%Y%m%d-%H%M%S).sql"

# retain the 30 most recent nightly dumps
ls -1t "$BDIR"/nightly-*.sql 2>/dev/null | tail -n +31 | xargs -r rm -f
# clean up any stray empty dumps (e.g. legacy 0-byte pre-migrate files)
find "$BDIR" -maxdepth 1 -name '*.sql' -size 0 -delete 2>/dev/null || true
