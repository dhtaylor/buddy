# Buddy — Requirements & Specification

_Self-hosted family finance & budget app. Last updated: 2026-06-20._

This document describes what Buddy **is and does** as of the end of the initial build session.
It is the reference for resuming work. For implementation conventions (folder layout, API
envelope, coding patterns) see `CONVENTIONS.md`; for the original approved plan see
`C:\Users\DandyTaylor\.claude\plans\we-are-going-to-elegant-lark.md`.

---

## 1. Purpose & end user

Digitize the family-finance system currently kept **by hand** by a non-technical 45-year-old
stay-at-home mom. The app must feel like her paper system (a checkbook ledger, weekly budget
sheets, and a floating-date bills list — see `resource photos/`), not a bank-automation tool.
She enters transactions by hand; automation (file import) only *supports* that by matching and
clearing what she already wrote down.

**Design priorities:** simplicity, large tap targets, mobile-first, forgiving forms, nothing
speculative. Correctness of money math above all.

---

## 2. Locked product decisions

| Decision | Choice |
|---|---|
| Hosting | Self-hosted on an always-on **Windows PC via Docker**; reachable on the home **LAN** (`http://<pc-ip>:8080`). Public web deferred. |
| Storage | Local **SQLite** file; backed up by copying. No cloud dependency. |
| Bank data | **CSV/OFX file import** (no Plaid/bank API). Used to auto-match & clear manual entries. |
| Ledger ↔ Budget | **Auto-linked by category** — budget "Actual" is derived from the ledger, never hand-copied. |
| Multi-tenancy | Multiple **households**, fully data-segregated. A user can belong to many and switch. |
| Roles | **System admin** (global) vs **household admin** (per-household owner) vs **member**. |
| Household creation | **System admin only**, and only from System Settings. |
| Registration | **Open only for the first user** (bootstrap admin); closed thereafter. |
| Budget period | Default **weekly (Sun–Sat)**; configurable (weekly/biweekly/monthly/custom). |
| Money | Stored as **integer cents**; formatted to dollars only at display. |

---

## 3. Architecture & tech stack

- **Monorepo** (npm workspaces): `shared/` (types + money/date utils), `server/` (API + static
  host), `web/` (UI).
- **Server:** Node + **Fastify** + TypeScript; **better-sqlite3** + **Drizzle ORM**; serves the
  built web app and the REST API on port **8080** (`0.0.0.0`). No third-party/outbound services.
- **Web:** **React 18 + Vite + TypeScript + Tailwind CSS + PWA** (`vite-plugin-pwa`,
  `registerType: autoUpdate`). **TanStack Query** for data; cookie-based auth via a small `api`
  client. Mobile-first; "Add to Home Screen" supported.
- **Auth:** local **email + password** (bcrypt), HttpOnly **encrypted session cookie**
  (`@fastify/secure-session`, cookie `buddy_session`, 30-day maxAge, `secure:false` on LAN).
- **Money:** integer cents everywhere (`toCents`/`fromCents`/`formatCents`/`parseCents`).
- **Dates:** ISO `YYYY-MM-DD` strings; period helpers (`periodFor`, `weeklyPeriod`, `periodLabel`).
- **File import libs:** `papaparse` (CSV), `node-ofx-parser` (OFX), `@fastify/multipart`.
- **Charts:** `recharts`.

---

## 4. Deployment

- `docker compose up -d --build` on the Windows host. SQLite DB volume-mounted at
  `server/data/buddy.sqlite`; `backups/` folder mounted.
- Windows Firewall: allow inbound TCP **8080** (one-time elevated `New-NetFirewallRule`).
- On her phone (same Wi-Fi): open `http://<pc-ip>:8080` **with `http://` explicit** (PWA install
  requires HTTPS/localhost, so full "install" only works over HTTPS — browser use works over HTTP).
- Demo/seed login: `demo@buddy.local` / `password123` (the seed user is a system admin).

---

## 5. Data model (SQLite / Drizzle)

All money columns are integer cents; dates are ISO text; every domain table carries `household_id`.

- **households** — id, name, periodLength, periodAnchorDate, periodCustomDays
- **users** — id, email (unique), passwordHash, displayName, **isAdmin** (global/system admin)
- **household_members** — id, householdId→households, userId→users, role (`owner` | `member`)
- **accounts** — id, householdId, name, type (`checking|savings|cash`), openingBalanceCents
- **categories** — id, householdId, groupName, name, kind (`income|expense`), sortOrder, **archived**
- **ledger_entries** — id, householdId, accountId, entryDate, payee, categoryId(nullable),
  amountCents (stored positive), direction (`debit|credit`), cleared, clearedDate, source
  (`manual|imported`), note. Running balance is **computed**, not stored.
- **budget_periods** — id, householdId, startDate, endDate, label
- **budget_lines** — id, periodId, categoryId, plannedCents, dueDate, note ("Actual" is derived)
- **bills** — id, householdId, name, categoryId(nullable), recurrence, typicalDay, note
- **bill_occurrences** — id, billId, dueDate, amountCents, paid, ledgerEntryId(nullable)
- **imports** — id, householdId, accountId, filename, sourceFormat (`csv|ofx`), importedAt,
  **confirmedAt** (null until confirmed)
- **imported_transactions** — id, importId, txnDate, description, amountCents (signed),
  fingerprint, status (`matched|new|ignored`), matchedEntryId(nullable)

Migrations live in `server/drizzle/`. Schema changes: edit `server/src/db/schema.ts` →
`npm run db:generate` (in `server/`) → `npm run db:migrate`.

---

## 6. Roles & permissions

- **System admin** (`users.isAdmin`): bootstrapped from the first registered user (seed user is
  admin). Can reach `/api/system/*`, create/rename/delete households, manage users & admins,
  assign household admins, run backups. Hidden from household admins who aren't system admins.
- **Household admin** = `owner` role in a household. May edit that household's settings
  (name/period, accounts, categories, members).
- **Member** = `member` role. Full use of the app (enter/categorize transactions, view
  everything) but household settings are **read-only**.
- **Enforcement:** every authenticated request re-checks household membership (`authGuard`).
  Settings *writes* additionally require `owner` (`requireHouseholdAdmin`); `/api/system/*`
  requires `isAdmin` (`requireSystemAdmin`). Client-side gating mirrors this but the server is
  the source of truth.
- **Isolation:** all data scoped by `household_id`; switching households clears the client cache
  (`qc.clear()`); a user cannot switch into a household they don't belong to (403).

---

## 7. Functional requirements (by screen)

**Home / Balance** — Big running balance (recorded + cleared). Weekly cards: income, projected
expenses, actual expenses (red when actual > projected). **Prev/Next period navigation** with a
"Jump to this week" reset; balance stays current (not period-scoped). "Add transaction" CTA.

**Ledger** — Checkbook register. Per-row computed **running balance** (per account). Pending vs
cleared distinction with a tap-to-clear toggle. Add/edit entry (debit/credit, payee, date, amount,
category, cleared). Account filter. "imported" badge + "Uncategorized" label on rows. Edit form
**jumps into view** when opened. **Bulk-categorize**: select multiple rows (incl. "select all
uncategorized") → apply one category. Recorded vs cleared balances via `/ledger/balance`.

**Budget** — Current period grouped by category: `Planned | Actual (auto) | Due date`. Over-budget
turns red. Configurable period (uses household setting); Prev/Next navigation. **Add budget item**
(creates a category in a group). **Hide** an item (archive — removes from Budget, keeps history).
An amber **"Uncategorized"** line shows unbudgeted/imported debits and is included in totals.

**Bills** — Upcoming occurrences grouped by week. Editable **floating due dates**. **Split** a bill
into multiple occurrences (the "half is…" pattern). **Mark paid** → creates a linked ledger entry
(debit, bill's category) and marks the occurrence paid (not idempotent; guarded by hiding the
button once paid).

**Import / Reconcile** — Upload a bank **CSV/OFX** for an account. App parses, dedupes, and
**auto-matches** each bank row to a manual, not-yet-cleared ledger entry (same account; equal
amount; matching direction; within ±4 days; exactly one candidate). Review screen: **Matched →
clear**, **New/unmatched → add (pick category) or ignore**. Confirm applies decisions. Cancel
discards the draft. Re-importing a **confirmed** file is skipped as duplicates; an **unconfirmed**
draft never blocks re-import.
  - CSV layouts: single signed `Amount` column, or two-column `Debit/Credit` (aliases tolerated);
    dates ISO or `M/D/YYYY`. OFX reads `STMTTRN` (signed `TRNAMT`).
  - Dedupe fingerprint: `sha256(accountId|txnDate|amountCents|normalizedDescription)`, only
    against **confirmed** imports.

**History** — Per-category spend over time (bucketed into household periods): table + recharts bar
chart; tap a category for its trend. Includes an **"Uncategorized"** bucket (categoryId `0`) so
imported/untagged spend is never lost. Archived categories still appear here.

**Settings** — split into:
- **Household Settings** (editable only by household admin; members get a read-only summary):
  household name + budget period; accounts & opening balances; categories (add / hide / unhide);
  members (list, add via "add spouse/partner", remove).
- **System Settings** (system admin only; hidden from household admins): overview counts;
  **Households** (list, rename, create, delete — delete blocked for the active one); **Users &
  admins** (list, create user into a household with a role, grant/revoke system admin, delete
  user, per-membership role control to **assign a household admin**, add a user to a household);
  **Backups** (list snapshots, "Back up now"). Creating a household here auto-adds the creator as
  its owner. Safeguards: can't remove the last system admin; can't delete your own account.
- Always: household **switcher** at the top (select only — creation lives in System Settings),
  **Log out**.

---

## 8. Security

- Bcrypt password hashing; HttpOnly encrypted session cookie; per-request membership check.
- **Registration closes** after the first admin (`GET /auth/registration-status` drives the UI).
- **Idle auto-logout** clears the in-memory cache and returns to login after inactivity
  (`VITE_IDLE_MINUTES`, default 15; build-time).
- **Strict same-origin CSP** + `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` on
  all responses (no third-party origins allowed).
- Client data cache is **in-memory only** (TanStack Query) — never persisted to disk; the service
  worker caches only app assets, not API responses. Cache cleared on logout and household switch.
- **For production/public web:** serve over HTTPS, set cookie `secure:true`, set a real
  `SESSION_KEY` (64 hex). Consider Tailscale or a Caddy reverse proxy for HTTPS on the LAN.

---

## 9. API surface (all under `/api`, JSON `{ data }` / `{ error: { code, message } }`)

- **auth:** `GET /auth/registration-status`, `POST /auth/register` (first user only),
  `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/add-spouse` (HH admin)
- **household:** `GET /household`, `PUT /household` (HH admin), `GET /household/mine`,
  `POST /household/switch`, `GET /household/members`, `DELETE /household/members/:userId` (HH admin)
- **accounts:** `GET` (member) · `POST` / `PUT /:id` / `DELETE /:id` (HH admin)
- **categories:** `GET` (member) · `POST` / `PUT /:id` / `DELETE /:id` / `PUT /:id/archived` (HH admin)
- **ledger:** `GET /` , `GET /balance`, `POST /`, `PUT /:id`, `DELETE /:id`,
  `PATCH|PUT /:id/cleared`, `POST /bulk-categorize`
- **budget:** `GET /?date`, `GET /summary?date`, `PUT /line`, `GET /periods`, `POST /period`
- **bills:** `GET /`, `GET /occurrences`, `POST /`, `PUT /:id`, `DELETE /:id`,
  `POST /:id/occurrences`, `PUT /occurrences/:id`, `POST /occurrences/:id/pay`
- **imports:** `GET /`, `POST /` (multipart), `GET /:id`, `POST /:id/confirm`, `DELETE /:id`
- **history:** `GET /by-category?from&to`, `GET /category/:id?from&to`
- **system (system admin only):** `GET /info`; households `GET` / `POST` / `PUT /:id` / `DELETE /:id`;
  users `GET` / `POST` / `PUT /:id/admin` / `DELETE /:id`; memberships `PUT` / `DELETE`;
  backups `GET /backups` / `POST /backup`
- `GET /health`

---

## 10. Testing & CI

- **`npm test`** runs the full **Vitest** suite (**78 tests**): unit tests (shared money/period
  utils; server pure logic: running balance, budget rollup, import match/dedupe, history
  bucketing) + **API integration tests** (`server/test/*.test.ts`) that build the real Fastify app
  with `inject()` against a **throwaway temp DB** (no running server, never touches real data).
  Integration coverage: auth/roles/permissions, finance (ledger/budget/uncategorized/bulk/archive/
  bills), imports (incl. the unconfirmed-dedupe regression), multi-tenant isolation.
- **Pre-commit hook** (`.githooks/pre-commit`, wired via `core.hooksPath` + `prepare` script):
  runs `npm run build` (type-check) + `npm test`; blocks the commit on failure
  (bypass: `git commit --no-verify`).
- **CI:** `.github/workflows/ci.yml` runs `npm ci → build → test` on push/PR (Node 22) — activates
  once a GitHub remote is added.

---

## 11. Commands

From repo root: `npm install` · `npm run db:migrate` · `npm run seed` · `npm run dev`
(web :5173 proxying to server :8080) · `npm run build` · `npm test` · `npm run backup`.
In `server/`: `npm run db:generate` (after schema edits) · `npm run start` (run built server).

---

## 12. Open action items / next steps

**Housekeeping**
- [ ] Commit this session's work to git (currently **staged but uncommitted**) and add a GitHub
      remote so CI runs.

**Requested-but-not-built (offered, deferred)**
- [ ] **Auto-seed default categories** when a household is created (new households start empty —
      no accounts, no categories — so Budget is blank until set up).
- [ ] **Restrict "add member"** (add-spouse) to admins, if full admin-only provisioning is wanted
      (currently any household admin can add members to their own household).
- [ ] **Per-row category assignment in the import review** screen (faster than bulk-categorizing
      after the fact).

**Known gaps / to verify**
- [ ] A household can be left with **zero owners** (system admin can demote/remove the only owner).
      Consider enforcing "≥1 household admin" or an ownership-transfer flow.
- [ ] Web bundle is a single ~644 KB chunk — fine, but could be code-split if load time matters.
- [ ] Idle timeout is **build-time** (`VITE_IDLE_MINUTES`); could become a runtime/admin setting.

**Deferred by design (future)**
- [ ] Public-web deployment hardening: HTTPS, `secure` cookie, real `SESSION_KEY`, reverse proxy /
      Tailscale.
- [ ] Live bank feed (Plaid / SimpleFIN) as an alternative to CSV/OFX import.
