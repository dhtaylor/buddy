# Buddy — Claude instructions

Buddy is a self-hosted, multi-tenant family finance/budget PWA (primary end user: Megan, who budgets by hand). This is the quick operational reference. The full spec lives in `REQUIREMENTS.md` and conventions in `CONVENTIONS.md` — read those for detail.

## Stack
- npm-workspaces monorepo: `shared/` (types), `server/` (Fastify API + serves the built web app), `web/` (React + Vite + Tailwind + PWA).
- **PostgreSQL via Drizzle** — postgres.js in prod, in-process **PGlite** for tests (so `npm test` needs no DB server).
- **Money is integer cents.** Dates are ISO strings; budget periods default to weekly (Sun–Sat).

## Ship loop (every change)
1. Edit → `npm run build` + tests.
2. Commit — the **pre-commit hook runs the full build + test suite** (must be green). Branch, then fast-forward to `main`.
3. Push to `github.com/dhtaylor/buddy` — GitHub Actions CI re-runs build + test, then (on `main`) builds a **linux/arm64** image and pushes it to `ghcr.io/dhtaylor/buddy` (tagged with the commit sha and `latest`).
4. Deploy = **`infra/deploy-lilnas.ps1`**, run from the Windows dev box. It records the previous tag, takes a pre-deploy DB snapshot, sets `BUDDY_TAG` in the NAS's `.env`, pulls, `docker compose up -d`, health-gates on `/health`, and **auto-rolls-back** on failure. `infra/deploy-lilnas.ps1 rollback` re-pins the previous tag.

## Deploy / runtime facts
- **Live = the Docker stack on `lilnas`**, a Raspberry Pi 5 (ARM64) running OpenMediaVault 7 / Debian bookworm at **192.168.1.197**, stack at `/srv/buddy/` (containers `buddy` / `buddy-caddy` / `buddy-db`) — **not** the Windows PC and **not** Azure. `infra/deploy.ps1` (Azure) exists but is unused (cost). The Windows PC is dev-only: `docker compose up -d db` + `npm run dev`.
- The `buddy` image is **pulled from GHCR**, never built on the NAS. The NAS authenticates to the private registry via a `read:packages` token (`docker login`).
- Postgres data and backups live on the **RAID5 pool** via bind mounts under `BUDDY_DATA_DIR` (`/srv/dev-disk-by-uuid-.../buddy/{pgdata,backups}`), not `./data/pg`.
- Secrets (`SESSION_KEY`, `POSTGRES_PASSWORD`, `BUDDY_TAG`, `BUDDY_DATA_DIR`) live in `/srv/buddy/.env` on the NAS only — not committed.
- **Migrations auto-apply on container start** (the entrypoint runs `db:migrate` then starts the server) — there is no manual migration step.
- Access: phone → `http://192.168.1.197:8080`; desktop → `https://buddy.lan` (Caddy local CA, migrated from the old Windows Caddy so existing devices still trust it; new devices need the NAS Caddy root installed). Each device needs `buddy.lan` → `192.168.1.197` (hosts entry or LAN DNS).
- The session cookie is non-Secure on the LAN (`COOKIE_SECURE=false`, plain HTTP by design).

## Gotchas (learned the hard way)
- **The PWA caches the old bundle** — after a deploy, hard-refresh / clear the service-worker cache or you'll see stale UI.
- **Back up the DB before any destructive data change:** on the NAS, `ssh lilnas /srv/buddy/backup.sh <prefix>` (dumps via `buddy-db`'s own pg_dump, version-matched to pg16).
- **`docker exec` needs `-i` for stdin** — without it, a piped heredoc / SQL silently never reaches psql (looks like success, changes nothing).
- Tests run on PGlite. For real-Postgres validation via Docker, ensure `.dockerignore` excludes `node_modules` / `dist` / `*.tsbuildinfo` (a stale composite build silently breaks the server build).

## Conventions
- Local git identity: `Dandy Taylor <dandy@tiandata.com>`.
- Verify UI changes visually in-browser (claude-in-chrome). Note: a full page reload logs you out (auth gate).
