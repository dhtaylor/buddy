#!/bin/sh
# Container entrypoint: apply migrations (must succeed), then start the server.
#
# The pre-migration DB snapshot (gap #2) is taken HOST-SIDE by the deploy
# script (deploy-lilnas.ps1 -> infra/lilnas/backup.sh) using the db
# container's own pg_dump, which is version-matched to the server. We do not
# dump from here because this image's postgresql-client may be an older major
# than the server, and pg_dump refuses to dump a newer server.
set -e

# Migrations must succeed — do not start the server on a broken schema.
npm run db:migrate

exec node server/dist/index.js
