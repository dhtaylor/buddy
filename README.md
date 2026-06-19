# Buddy — Self-hosted Family Finance & Budget

Mobile-first PWA that digitizes a hand-kept family ledger/budget/bills system.
Monorepo (npm workspaces): `shared/` (types + money/date utils), `server/` (Fastify +
better-sqlite3 + Drizzle), `web/` (React + Vite + Tailwind + PWA).

**Feature agents: read [`CONVENTIONS.md`](./CONVENTIONS.md) — it is the contract.**

## Prerequisites
- Node 20+ and npm.
- (Deploy) Docker Desktop for Windows.

## Local development
```bash
npm install
npm run db:migrate     # create/upgrade the SQLite schema
npm run seed           # demo household + seeded categories (demo@buddy.local / password123)
npm run dev            # web on :5173 (proxies /api), server on :8080
```
Other scripts: `npm run build` (all workspaces), `npm test` (shared utils), `npm run db:generate` (regenerate migration SQL after editing the schema — run inside `server/`).

## Deploy with Docker (always-on Windows PC)
```bash
docker compose up -d --build
```
- App: `http://localhost:8080` on the host; `http://<pc-ip>:8080` from a phone on the LAN.
- The SQLite DB lives in `./data/buddy.sqlite` (volume-mounted); back it up by copying that file.
- For production, set a real `SESSION_KEY` (64 hex chars: `openssl rand -hex 32`) in `docker-compose.yml`.

### Windows Firewall (so her phone can reach it)
Allow inbound TCP 8080 once, from an **elevated** PowerShell:
```powershell
New-NetFirewallRule -DisplayName "Buddy 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080
```
Find the PC's LAN IP with `ipconfig` (IPv4 Address), then open `http://<that-ip>:8080` on the phone and "Add to Home Screen."

## OFX / SQLite library choices
- **SQLite:** `better-sqlite3` (synchronous, fast, simple). Installs cleanly on Windows with Node 20+ prebuilt binaries.
- **OFX parsing:** `node-ofx-parser` (pure JS, no native build) for the Phase 5 import feature. CSV via `papaparse`. Both installed server-side already.
