# Buddy — Self-hosted Family Finance & Budget

Mobile-first PWA that digitizes a hand-kept family ledger/budget/bills system.
Monorepo (npm workspaces): `shared/` (types + money/date utils), `server/` (Fastify +
**Postgres** + Drizzle), `web/` (React + Vite + Tailwind + PWA).

**Read [`CONVENTIONS.md`](./CONVENTIONS.md) for coding conventions and [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the spec.**

User guides: [`docs/heloc.md`](./docs/heloc.md) — the optional HELOC cash-sweep (velocity-banking) view.

## Prerequisites
- Node 20+ and npm.
- Docker Desktop (provides Postgres for local dev).

## Local development (Windows PC — dev only, not production)
```bash
docker compose up -d db   # local Postgres (localhost:5432; bound to 127.0.0.1)
npm install
npm run db:migrate        # apply the schema (uses DATABASE_URL, default localhost:5432)
npm run seed              # optional demo data (demo@buddy.local / password123) — or just register the first user
npm run dev               # web on :5173 (proxies /api), server on :8080
```
Other scripts: `npm run build` (all workspaces), `npm test` (full suite — unit + API integration tests; runs on in-process **PGlite**, so **no running DB/server needed**), `npm run db:generate` (regenerate migration SQL after editing the schema — run inside `server/`), `npm run backup` (pg_dump snapshot).

## Production: lilnas (Raspberry Pi 5 NAS)
Production runs on **`lilnas`**, a Raspberry Pi 5 (ARM64) running OpenMediaVault 7 / Debian
bookworm at `192.168.1.197`. The stack lives at `/srv/buddy/` on the NAS (Docker Compose:
`infra/lilnas/docker-compose.yml`) — `buddy` (image pulled from `ghcr.io/dhtaylor/buddy`, arm64),
`buddy-db` (`postgres:16-alpine`), `buddy-caddy` (:443, `buddy.lan`). Postgres data and backups
live on the **RAID5 storage pool** via bind mounts under `BUDDY_DATA_DIR`
(`/srv/dev-disk-by-uuid-.../buddy/{pgdata,backups}`). Secrets (`SESSION_KEY`,
`POSTGRES_PASSWORD`, `BUDDY_TAG`, `BUDDY_DATA_DIR`) live in `/srv/buddy/.env` on the NAS only —
not committed.

**Release flow:** push to `main` → GitHub Actions builds a **linux/arm64** image and pushes it to
GHCR (private registry; the NAS authenticates via a `read:packages` token set up with
`docker login`). Deploy from the Windows dev box with:
```powershell
pwsh ./infra/deploy-lilnas.ps1
```
This records the previous tag, takes a pre-deploy DB snapshot, sets `BUDDY_TAG` in the remote
`.env`, pulls the image, `docker compose up -d`, health-gates on `/health`, and
**auto-rolls-back** on failure. To roll back manually: `pwsh ./infra/deploy-lilnas.ps1 rollback`
(re-pins the previous tag).

Migrations auto-apply on container start (the entrypoint runs `db:migrate` then starts the
server) — there is no manual migration step.

### Backups
A nightly **cron job on the NAS** runs `/srv/buddy/backup.sh`, which dumps via `buddy-db`'s own
`pg_dump` (version-matched to Postgres 16) to `${BUDDY_DATA_DIR}/backups/nightly-*.sql` (keeps the
most recent 30). `infra/deploy-lilnas.ps1` also takes a `pre-deploy-<sha>` snapshot before every
deploy. Also available in the app: **System Settings → Backups → Back up now** — this works
because the app image ships `postgresql-client-16`.

### Security
- Strict same-origin **Content-Security-Policy** + `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options` on every response.
- bcrypt passwords; HttpOnly **encrypted session cookie**; per-request household-membership
  check; open registration closes after the first admin.
- **Idle auto-logout** clears the in-memory cache after inactivity (default 15 min; set
  `VITE_IDLE_MINUTES` at web build time).
- Keep the repo **private** — `resource photos/` contain real financial data.
- `COOKIE_SECURE=false` on lilnas — it's a plain-HTTP LAN deployment; a `Secure` cookie is
  silently dropped over HTTP on a non-localhost host, which would break login.

### Access
- Phones: `http://192.168.1.197:8080`.
- Desktops: `https://buddy.lan` (Caddy local CA — the same CA was migrated from the old Windows
  Caddy setup, so existing devices keep trusting it; new devices need the NAS Caddy root
  installed). Each device needs `buddy.lan` → `192.168.1.197` (a hosts entry or a LAN DNS
  record).

## Library choices
- **Database:** PostgreSQL via Drizzle (`postgres` driver in production; **PGlite** in-process for tests).
- **OFX parsing:** `node-ofx-parser` (pure JS); CSV via `papaparse`.
