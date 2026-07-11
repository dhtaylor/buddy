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

# Back up the Caddy state (its local CA private key + issued certs) so buddy.lan
# trust survives a Caddy rebuild — otherwise every device would have to re-install
# the CA. It's tiny and rarely changes, so keep a single current copy, written to a
# temp file first and only moved into place on success so a caddy-down run can never
# clobber a good backup with an empty file.
tmp="$BDIR/.caddy-ca.tar.gz.tmp"
if docker exec buddy-caddy tar cf - -C /data caddy 2>/dev/null | gzip > "$tmp" && [ -s "$tmp" ]; then
  mv -f "$tmp" "$BDIR/caddy-ca.tar.gz"
else
  rm -f "$tmp"
fi

# retain the 30 most recent nightly dumps
ls -1t "$BDIR"/nightly-*.sql 2>/dev/null | tail -n +31 | xargs -r rm -f
# clean up any stray empty dumps (e.g. legacy 0-byte pre-migrate files)
find "$BDIR" -maxdepth 1 -name '*.sql' -size 0 -delete 2>/dev/null || true
