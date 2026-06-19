# Buddy — CONVENTIONS (the contract for feature agents)

Read this whole file plus `server/src/db/schema.ts` before writing a feature. If you
follow it, your feature will not break others. **Phase 0 + Phase 1 are done**
(scaffold, auth, accounts, categories, household). Everything else is stubbed and
already wired — you fill in the stubs, you do **not** edit shared wiring.

---

## 1. Folder layout (2 levels)

```
buddy/
├─ package.json            # npm workspaces root; dev/build/test/seed/db:migrate scripts
├─ tsconfig.base.json
├─ Dockerfile, docker-compose.yml, README.md, CONVENTIONS.md
├─ shared/                 # @buddy/shared — pure TS: types + money/date utils (NO deps on server/web)
│  └─ src/ money.ts period.ts types.ts index.ts (+ *.test.ts)
├─ server/                 # @buddy/server — Fastify + better-sqlite3 + Drizzle
│  ├─ drizzle.config.ts, drizzle/ (generated migrations)
│  └─ src/
│     ├─ index.ts          # entry (listen 0.0.0.0:8080) — DO NOT EDIT
│     ├─ app.ts            # builds Fastify, registers ALL routes — DO NOT EDIT
│     ├─ config.ts
│     ├─ db/ index.ts schema.ts migrate.ts seed.ts
│     ├─ lib/ auth.ts errors.ts
│     └─ routes/ auth.ts accounts.ts categories.ts household.ts   (DONE)
│                ledger.ts budget.ts bills.ts imports.ts history.ts (STUBS — yours)
└─ web/                    # @buddy/web — React 18 + Vite + Tailwind + PWA + TanStack Query
   └─ src/
      ├─ main.tsx App.tsx index.css       # DO NOT EDIT (router + shell + nav)
      ├─ components/ BottomNav.tsx
      ├─ api/ client.ts queryClient.ts auth.ts accounts.ts categories.ts household.ts (DONE)
      │       ledger.ts budget.ts bills.ts imports.ts history.ts (STUBS — yours)
      └─ pages/ Login.tsx Settings.tsx (DONE) Home/Ledger/Budget/Bills/Import/History.tsx (STUBS — yours)
```

---

## 2. How to add a feature (which files you own)

Each feature owns exactly THREE files, all already created and wired:

| Feature | Server route (`/api/<x>`)      | Web page                  | Web api hooks                |
|---------|--------------------------------|---------------------------|------------------------------|
| Ledger  | `server/src/routes/ledger.ts`  | `web/src/pages/Ledger.tsx`| `web/src/api/ledger.ts`      |
| Budget  | `server/src/routes/budget.ts`  | `web/src/pages/Budget.tsx`| `web/src/api/budget.ts`      |
| Bills   | `server/src/routes/bills.ts`   | `web/src/pages/Bills.tsx` | `web/src/api/bills.ts`       |
| Import  | `server/src/routes/imports.ts` | `web/src/pages/Import.tsx`| `web/src/api/imports.ts`     |
| History | `server/src/routes/history.ts` | `web/src/pages/History.tsx`| `web/src/api/history.ts`     |
| Home    | (reads ledger/budget APIs)     | `web/src/pages/Home.tsx`  | (reuse other hooks)          |

These are **already registered/routed** — confirmed:
- Route plugins are registered in `server/src/app.ts` under `/api/<name>`. Do **not** edit `app.ts` or `index.ts`.
- Pages are routed in `web/src/App.tsx` and linked in `components/BottomNav.tsx`. Do **not** edit those.
- The stub route currently returns 501; replace its body with real handlers.

If you need a NEW shared type or util, add it to `shared/src/` and export it from
`shared/src/index.ts` — never duplicate types in server/web. Run `npm run build --workspace shared` after.

Do **not** touch `package.json` files — all dependencies are already installed (see §10).

---

## 3. API response shape & error convention

- **Success:** always `{ "data": <T> }` with a 2xx status. Return `reply.send({ data })`
  (or `reply.code(201).send({ data })`).
- **Error:** always `{ "error": { "code": string, "message": string } }` with a non-2xx status.
- Throw the helpers from `server/src/lib/errors.ts` (`badRequest`, `unauthorized`,
  `forbidden`, `notFound`, `conflict`) — the global error handler in `app.ts` formats them.
- Zod validation errors are auto-converted to `{ error: { code: 'validation_error', ... } }` (400).
- Validate request bodies with **zod** (`z.object(...).parse(req.body)`).

---

## 4. Auth / session usage (server)

```ts
import { authGuard, requireSession } from '../lib/auth.js';

const routes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);          // 401s unauthenticated requests
  app.get('/', async (req, reply) => {
    const { userId, householdId } = requireSession(req);  // both numbers, guaranteed
    // ... scope EVERY query by householdId ...
  });
};
export default routes;
```

- Sessions are HTTP-only encrypted cookies via `@fastify/secure-session` (cookie `buddy_session`).
- `requireSession(req)` returns `{ userId, householdId }` or throws 401. Call it in every handler.

---

## 5. Household scoping (NON-NEGOTIABLE)

Every domain table has a `household_id` (`householdId`). **Every** read/write MUST be
filtered by the caller's `householdId` from the session — never trust an id from the body
for scoping. Pattern:

```ts
import { and, eq } from 'drizzle-orm';
const rows = db.select().from(ledgerEntries)
  .where(eq(ledgerEntries.householdId, householdId)).all();

// updates/deletes must AND the household_id so users can't touch other households:
db.update(accounts).set(patch)
  .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
  .returning().get();
```
Tables scoped directly by `household_id`: households(id), accounts, categories,
ledger_entries, budget_periods, bills, imports. Child tables scope **through their parent**:
`budget_lines`→budget_periods, `bill_occurrences`→bills, `imported_transactions`→imports.
Join/verify the parent's household before mutating a child.

---

## 6. Money utilities (`@buddy/shared`) — exact signatures

All money is **integer cents**. Never use floats for money. Format only at display.
```ts
toCents(dollars: number): number          // 12.34 -> 1234 (half-away-from-zero, drift-safe)
fromCents(cents: number): number          // 1234 -> 12.34
formatCents(cents: number): string        // 123456 -> "$1,234.56"; -500 -> "-$5.00"
parseCents(input: string): number | null  // "$1,234.56" -> 123456; "(5)" -> -500; bad -> null
```

## 7. Date / period utilities (`@buddy/shared`) — exact signatures

Dates are ISO `"YYYY-MM-DD"` strings everywhere (DB columns + DTOs). No timestamps for calendar dates.
```ts
type PeriodLength = 'weekly' | 'biweekly' | 'monthly' | 'custom';
interface Period { startDate: string; endDate: string; }   // both inclusive ISO dates

parseISODate(iso: string): Date            // UTC midnight; throws if invalid
toISODate(date: Date): string
addDays(iso: string, days: number): string
addMonths(iso: string, months: number): string   // clamps day to month length
diffDays(startIso: string, endIso: string): number
isInPeriod(iso: string, period: Period): boolean  // inclusive both ends
weeklyPeriod(iso: string): Period                 // the Sun–Sat week containing iso
periodFor(iso, length, anchorDate, customDays?): Period   // bucket a date for any length
periodLabel(period: Period): string               // "May 31 – Jun 6"
```
`periodFor` aligns biweekly/weekly/custom windows to `anchorDate`, and monthly windows to
the anchor's day-of-month. The household stores `periodLength`, `periodAnchorDate`,
`periodCustomDays` (read via `GET /api/household`) — use those when bucketing ledger
entries into budget periods.

---

## 8. TanStack Query + `api` client (web)

`web/src/api/client.ts` exports `api` and `ApiClientError`:
```ts
api.get<T>(path)            // GET  /api${path}
api.post<T>(path, body?)    // POST
api.put<T>(path, body?)     // PUT
api.del<T>(path)            // DELETE
```
It sends cookies (`credentials: 'include'`), unwraps `{ data }` to `T`, and throws
`ApiClientError { status, code, message }` on non-2xx. **Never call `fetch` directly.**

Hook pattern (mirror `web/src/api/accounts.ts`):
```ts
export function useThings() {
  return useQuery<Thing[]>({ queryKey: ['things'], queryFn: () => api.get<Thing[]>('/things') });
}
export function useCreateThing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ThingInput) => api.post<Thing>('/things', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['things'] }),
  });
}
```
Query-key convention: top-level resource name, e.g. `['ledger']`, `['budget', periodId]`,
`['household','members']`. Invalidate the keys your mutation affects.
The `QueryClient` is configured in `web/src/api/queryClient.ts` and provided in `main.tsx`.
Import shared types from `@buddy/shared` (e.g. `import type { LedgerEntry } from '@buddy/shared'`).

Tailwind component classes available in `index.css`: `.input .select .btn-primary
.btn-secondary .btn-danger .card`. Mobile-first, big tap targets (min 44px). The app shell
already provides the bottom nav and `max-w-screen-sm` centering; your page just renders content.

---

## 9. Drizzle schema (`server/src/db/schema.ts`) — tables & columns

Money columns end in `_cents` (INTEGER). Date columns are TEXT ISO `YYYY-MM-DD`. Booleans
are `integer({ mode: 'boolean' })`. Camel-case TS keys map to snake_case columns.

- **households**: id, name, periodLength('weekly'|'biweekly'|'monthly'|'custom'), periodAnchorDate(ISO), periodCustomDays(int|null)
- **users**: id, email(unique), passwordHash, displayName
- **household_members**: id, householdId→households, userId→users, role('owner'|'member')
- **accounts**: id, householdId, name, type('checking'|'savings'|'cash'), openingBalanceCents
- **categories**: id, householdId, groupName, name, kind('income'|'expense'), sortOrder
- **ledger_entries**: id, householdId, accountId→accounts, entryDate(ISO), payee, categoryId→categories(nullable), amountCents, direction('debit'|'credit'), cleared(bool), clearedDate(ISO|null), source('manual'|'imported'), note(null)
- **budget_periods**: id, householdId, startDate(ISO), endDate(ISO), label
- **budget_lines**: id, periodId→budget_periods, categoryId→categories, plannedCents, dueDate(ISO|null), note(null)
- **bills**: id, householdId, name, categoryId→categories(nullable), recurrence('monthly'|'weekly'|'biweekly'|'yearly'|'custom'), typicalDay(int|null), note(null)
- **bill_occurrences**: id, billId→bills, dueDate(ISO), amountCents, paid(bool), ledgerEntryId→ledger_entries(nullable)
- **imports**: id, householdId, accountId→accounts, filename, sourceFormat('csv'|'ofx'), importedAt(ISO datetime)
- **imported_transactions**: id, importId→imports, txnDate(ISO), description, amountCents, fingerprint, status('matched'|'new'|'ignored'), matchedEntryId→ledger_entries(nullable)

Notes: running balance is **computed**, never stored. Budget "Actual" is **derived** by
summing ledger_entries by category within a period — do not store it. amount_cents is stored
positive; use `direction` for in/out.

**Changing the schema:** edit `schema.ts`, then from `server/`: `npm run db:generate`
(creates SQL in `drizzle/`), then `npm run db:migrate`. Mirror any new row shape into a DTO
in `shared/src/types.ts`. Use enum string unions exactly as above.

---

## 10. Commands

From the repo root:
```bash
npm install            # once; all deps for all workspaces already declared
npm run db:migrate     # apply migrations (creates ./data/buddy.sqlite)
npm run seed           # demo household + 28 seeded categories (demo@buddy.local / password123)
npm run dev            # builds shared, then runs server :8080 + web :5173 (proxies /api)
npm run build          # builds shared -> server -> web (run before committing)
npm test               # Vitest for shared money/period utils
```
Inside `server/`: `npm run db:generate` (after schema edits), `npm run start` (run built server).

**Build order matters:** `@buddy/shared` must be built (`dist/`) before the server runs,
because the package's runtime entry is `dist/index.js`. `npm run dev` and `npm run build`
handle this for you.

---

## 11. Chosen libraries / decisions

- **SQLite:** `better-sqlite3@^12` (synchronous; Node 22 + 24 prebuilt binaries — no compiler needed).
- **OFX (Phase 5):** `node-ofx-parser@^0.5.1` (pure JS). **CSV:** `papaparse`. Both installed server-side.
- **Charts (History):** `recharts`.
- **File upload (Import):** `@fastify/multipart` is registered globally; use `req.file()` / `req.parts()`.
- **Session key:** dev default in `config.ts`; set real `SESSION_KEY` (64 hex) in prod.
```
