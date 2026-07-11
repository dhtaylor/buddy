# Multi-stage build: install + build all workspaces, then run the server
# which serves the built web app on port 8080.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install all workspace deps (root + shared + server + web).
# (No native build toolchain needed — Postgres driver + PGlite are pure JS/WASM.)
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install

# Copy sources and build.
COPY . .
RUN npm run build

# --- Runtime image ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV WEB_DIST_PATH=/app/web/dist
ENV BACKUP_DIR=/backups

# postgresql-client-16 provides a pg_dump matching the Postgres 16 server, for
# the in-app "Back up now" feature. (Debian bookworm's default postgresql-client
# is v15, which refuses to dump a newer server.) Install from the PGDG apt repo.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

# Copy the whole built tree (simple + reliable for a small home app).
COPY --from=build /app /app

# docker-entrypoint.sh is already present via the COPY --from=build above.
RUN chmod +x /app/docker-entrypoint.sh

RUN mkdir -p /backups
EXPOSE 8080
# Apply migrations on boot, then start. (Pre-migration snapshots are taken
# host-side by the deploy script; see docker-entrypoint.sh.)
CMD ["sh", "/app/docker-entrypoint.sh"]
