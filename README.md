# Buddy — Self-hosted Family Finance & Budget

Mobile-first PWA that digitizes a hand-kept family ledger/budget/bills system.
Monorepo (npm workspaces): `shared/` (types + money/date utils), `server/` (Fastify +
**Postgres** + Drizzle), `web/` (React + Vite + Tailwind + PWA).

**Read [`CONVENTIONS.md`](./CONVENTIONS.md) for coding conventions and [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the spec.**

User guides: [`docs/heloc.md`](./docs/heloc.md) — the optional HELOC cash-sweep (velocity-banking) view.

## Prerequisites
- Node 20+ and npm.
- Docker Desktop (provides Postgres locally and runs the app in production).

## Local development
```bash
docker compose up -d db   # local Postgres (localhost:5432; bound to 127.0.0.1)
npm install
npm run db:migrate        # apply the schema (uses DATABASE_URL, default localhost:5432)
npm run seed              # optional demo data (demo@buddy.local / password123) — or just register the first user
npm run dev               # web on :5173 (proxies /api), server on :8080
```
Other scripts: `npm run build` (all workspaces), `npm test` (full suite — unit + API integration tests; runs on in-process **PGlite**, so **no running DB/server needed**), `npm run db:generate` (regenerate migration SQL after editing the schema — run inside `server/`), `npm run backup` (pg_dump snapshot).

## Deploy with Docker (always-on Windows PC)
```bash
docker compose up -d --build
```
Runs Postgres + the app together. App: `http://localhost:8080` on the host; `http://<pc-ip>:8080`
from a phone on the LAN. Postgres data persists in `./data/pg`. Set a real `SESSION_KEY`
(64 hex: `openssl rand -hex 32`) and `COOKIE_SECURE=true` (if behind HTTPS) in `docker-compose.yml`.

### Backups
`npm run backup` runs `pg_dump` to `./backups/buddy-YYYYMMDD-HHMMSS.sql` (keeps the most recent 30;
override with `BACKUP_KEEP`). Also available in the app: **System Settings → Backups → Back up now**.
Nightly on the Windows host via Task Scheduler:
```powershell
$action  = New-ScheduledTaskAction -Execute "npm" -Argument "run backup" -WorkingDirectory "C:\DATA\claude\projects\personal\buddy"
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "Buddy nightly backup" -Action $action -Trigger $trigger -RunLevel Highest
```

## Deploy to Azure (App Service + Postgres + Key Vault)
```powershell
az login
pwsh ./infra/deploy.ps1 -ResourceGroup buddy-rg -Location eastus
```
Provisions: Azure Container Registry (builds the image in the cloud — no local Docker), **Azure
Database for PostgreSQL Flexible Server** (Burstable B1ms), **Key Vault** (SESSION_KEY + DB
connection string), and a **Linux App Service for Containers** (B1) whose **managed identity**
reads those secrets via Key Vault references. **HTTPS is automatic**, `NODE_ENV=production` turns
on the `Secure` cookie, and DB migrations run on container start. First visit → register the first
user (becomes the system admin). ~$25–30/mo. Requires Contributor + User Access Administrator
(role assignments are created). Review the script before running.

### Security
- Strict same-origin **Content-Security-Policy** + `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options` on every response.
- bcrypt passwords; HttpOnly **encrypted session cookie** (`Secure` in production); per-request
  household-membership check; open registration closes after the first admin.
- **Idle auto-logout** clears the in-memory cache after inactivity (default 15 min; set
  `VITE_IDLE_MINUTES` at web build time).
- Keep the repo **private** — `resource photos/` contain real financial data.

### Windows Firewall (LAN access for her phone)
Allow inbound TCP 8080 once, from an **elevated** PowerShell:
```powershell
New-NetFirewallRule -DisplayName "Buddy 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080
```
Find the PC's LAN IP with `ipconfig`, then open `http://<that-ip>:8080` on the phone and "Add to Home Screen."

## Library choices
- **Database:** PostgreSQL via Drizzle (`postgres` driver in production; **PGlite** in-process for tests).
- **OFX parsing:** `node-ofx-parser` (pure JS); CSV via `papaparse`.
