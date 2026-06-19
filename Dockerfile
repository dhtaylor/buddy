# Multi-stage build: install + build all workspaces, then run the server
# which serves the built web app on port 8080.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install build toolchain for better-sqlite3 native module.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install all workspace deps (root + shared + server + web).
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
ENV DATABASE_PATH=/data/buddy.sqlite
ENV WEB_DIST_PATH=/app/web/dist

# Copy the whole built tree (simple + reliable for a small home app).
COPY --from=build /app /app

# Apply migrations + seed on first boot, then start the server.
RUN mkdir -p /data
EXPOSE 8080
CMD ["sh", "-c", "npm run db:migrate && npm run seed; node server/dist/index.js"]
