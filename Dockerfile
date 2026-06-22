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

# postgresql-client provides pg_dump for in-app backups.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# Copy the whole built tree (simple + reliable for a small home app).
COPY --from=build /app /app

RUN mkdir -p /backups
EXPOSE 8080
# Apply migrations on boot, then start. (Register the first user to bootstrap the
# admin; or run `npm run seed` once for demo data.)
CMD ["sh", "-c", "npm run db:migrate && node server/dist/index.js"]
