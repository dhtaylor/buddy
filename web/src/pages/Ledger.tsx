import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, NotebookText, Receipt } from 'lucide-react';
import {
  formatCents,
  parseCents,
  periodLabel,
  weeklyPeriod,
  type Category,
  type EntryDirection,
} from '@buddy/shared';
import EmptyState from '../components/EmptyState.js';
import { SkeletonCard } from '../components/Skeleton.js';
import { useAccounts } from '../api/accounts.js';
import { useCategories } from '../api/categories.js';
import {
  useBulkCategorize,
  useCreateLedgerEntry,
  useCreateTransfer,
  useDeleteLedgerEntry,
  useLedger,
  useToggleCleared,
  useUpdateLedgerEntry,
  type LedgerEntryInput,
  type LedgerEntryWithBalance,
  type TransferInput,
} from '../api/ledger.js';

/** Money text color, matching Home: red for negative, green for positive. */
function amountColor(cents: number): string {
  return cents < 0 ? 'text-red-600' : cents > 0 ? 'text-green-700' : 'text-gray-500';
}

/** Local calendar "today" as ISO YYYY-MM-DD (avoids UTC off-by-one). */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A ledger entry is a debit or credit; a transfer is just another kind, so the
// form's single `kind` picker covers all three.
type EntryKind = EntryDirection | 'transfer';

type FormState = {
  kind: EntryKind;
  accountId: number | '';
  // Transfer-only: source and destination accounts.
  fromAccountId: number | '';
  toAccountId: number | '';
  entryDate: string;
  payee: string;
  categoryId: number | '';
  amount: string;
  cleared: boolean;
  note: string;
};

function emptyForm(accountId: number | ''): FormState {
  return {
    kind: 'debit',
    accountId,
    fromAccountId: '',
    toAccountId: '',
    entryDate: todayISO(),
    payee: '',
    categoryId: '',
    amount: '',
    cleared: false,
    note: '',
  };
}

export default function Ledger() {
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const [accountFilter, setAccountFilter] = useState<number | ''>('');
  const params = accountFilter === '' ? {} : { accountId: accountFilter };
  const { data: entries, isLoading } = useLedger(params);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(''));
  const formRef = useRef<HTMLFormElement>(null);

  // The edit/add form renders at the top of the page; when opened from a row far
  // down the list, scroll it into view so it isn't missed.
  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [showForm, editingId]);

  const create = useCreateLedgerEntry();
  const createTransfer = useCreateTransfer();
  const update = useUpdateLedgerEntry();
  const del = useDeleteLedgerEntry();
  const toggle = useToggleCleared();
  const bulkCategorize = useBulkCategorize();

  // Bulk-categorize selection mode.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCat, setBulkCat] = useState<number | ''>('');

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setBulkCat('');
  }
  function applyBulk() {
    if (selected.size === 0) return;
    bulkCategorize.mutate(
      { ids: [...selected], categoryId: bulkCat === '' ? null : bulkCat },
      { onSuccess: exitSelect },
    );
  }

  const catById = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories ?? []) m.set(c.id, c);
    return m;
  }, [categories]);

  const acctById = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of accounts ?? []) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  // Newest-first for display; the API already attached per-account running balances.
  const display = useMemo(() => {
    const list = [...(entries ?? [])];
    list.sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : b.id - a.id));
    return list;
  }, [entries]);

  // Bucket the (already newest-first) list into Sun–Sat weeks. Insertion order
  // therefore puts the newest week first, and each group keeps the sort above.
  const weekGroups = useMemo(() => {
    type WeekGroup = {
      startDate: string;
      endDate: string;
      entries: LedgerEntryWithBalance[];
      netCents: number;
    };
    const groups: WeekGroup[] = [];
    const byStart = new Map<string, WeekGroup>();
    for (const e of display) {
      const { startDate, endDate } = weeklyPeriod(e.entryDate);
      let g = byStart.get(startDate);
      if (!g) {
        g = { startDate, endDate, entries: [], netCents: 0 };
        byStart.set(startDate, g);
        groups.push(g);
      }
      g.entries.push(e);
      g.netCents += e.direction === 'credit' ? e.amountCents : -e.amountCents;
    }
    return groups;
  }, [display]);

  // Computed per render, not memoized: a PWA left open past midnight must not
  // keep yesterday's week as "current".
  const today = todayISO();
  const currentWeekStart = weeklyPeriod(today).startDate;

  // One week is open by default and the rest are closed. Normally that's the
  // current week, but if it has no entries (Sunday morning, or an account whose
  // last activity was weeks ago) fall back to the newest group so the user never
  // lands on a page of nothing but collapsed headers.
  const defaultOpenStart = weekGroups.some((g) => g.startDate === currentWeekStart)
    ? currentWeekStart
    : weekGroups[0]?.startDate;

  // Holds only the weeks the user has explicitly toggled (keyed by week start
  // date, not index) so refetches and filter changes don't undo their choice.
  const [weekOverrides, setWeekOverrides] = useState<Record<string, boolean>>({});

  // Week labels omit the year, so weeks in other years would be ambiguous across
  // a full-history ledger. Qualify anything outside the current calendar year.
  const currentYear = today.slice(0, 4);
  function weekLabel(g: { startDate: string; endDate: string }): string {
    const startYear = g.startDate.slice(0, 4);
    return startYear === currentYear ? periodLabel(g) : `${periodLabel(g)}, ${startYear}`;
  }

  // Current balance to show prominently: latest running balance of the selected
  // account, or the sum of each account's latest running balance when unfiltered.
  const currentBalanceCents = useMemo(() => {
    if (!entries || entries.length === 0) {
      // Fall back to opening balances.
      if (accountFilter !== '') {
        const a = accounts?.find((x) => x.id === accountFilter);
        return a?.openingBalanceCents ?? 0;
      }
      return (accounts ?? []).reduce((s, a) => s + a.openingBalanceCents, 0);
    }
    if (accountFilter !== '') {
      return entries[entries.length - 1].runningBalanceCents;
    }
    // Unfiltered: last running balance per account, summed.
    const latest = new Map<number, number>();
    for (const a of accounts ?? []) latest.set(a.id, a.openingBalanceCents);
    for (const e of entries) latest.set(e.accountId, e.runningBalanceCents);
    return [...latest.values()].reduce((s, v) => s + v, 0);
  }, [entries, accounts, accountFilter]);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm(accountFilter !== '' ? accountFilter : accounts?.[0]?.id ?? ''));
    setShowForm(true);
  }

  function openEdit(e: LedgerEntryWithBalance) {
    setEditingId(e.id);
    setForm({
      kind: e.direction,
      accountId: e.accountId,
      fromAccountId: '',
      toAccountId: '',
      entryDate: e.entryDate,
      payee: e.payee,
      categoryId: e.categoryId ?? '',
      amount: formatCents(e.amountCents).replace('$', ''),
      cleared: e.cleared,
      note: e.note ?? '',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const cents = parseCents(form.amount);
    if (cents === null || cents < 0) return;

    const kind = form.kind;

    // Transfer is add-only: move money between two distinct accounts.
    if (kind === 'transfer') {
      if (form.fromAccountId === '' || form.toAccountId === '') return;
      if (form.fromAccountId === form.toAccountId || cents <= 0) return;
      const input: TransferInput = {
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amountCents: cents,
        entryDate: form.entryDate,
        cleared: form.cleared,
        note: form.note.trim() === '' ? null : form.note,
      };
      createTransfer.mutate(input, { onSuccess: closeForm });
      return;
    }

    if (form.accountId === '') return;
    const input: LedgerEntryInput = {
      accountId: form.accountId,
      entryDate: form.entryDate,
      payee: form.payee,
      categoryId: form.categoryId === '' ? null : form.categoryId,
      amountCents: cents,
      direction: kind,
      cleared: form.cleared,
      clearedDate: form.cleared ? form.entryDate : null,
      note: form.note.trim() === '' ? null : form.note,
    };
    if (editingId === null) {
      create.mutate(input, { onSuccess: closeForm });
    } else {
      update.mutate({ id: editingId, ...input }, { onSuccess: closeForm });
    }
  }

  if (!accounts || accounts.length === 0) {
    return (
      <EmptyState
        icon={NotebookText}
        title="No accounts yet"
        message="You need an account before you can record transactions."
        cta={{ label: 'Add an account', to: '/settings' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ledger</h1>
        <div className="flex gap-2">
          {!selectMode && display.length > 0 && (
            <button className="btn-secondary" onClick={() => setSelectMode(true)}>
              Categorize
            </button>
          )}
          {!selectMode && (
            <button className="btn-primary" onClick={openAdd}>
              Add
            </button>
          )}
        </div>
      </div>

      <div className="card flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">Current balance</span>
        <span className={`text-2xl font-bold tabular-nums ${amountColor(currentBalanceCents)}`}>
          {formatCents(currentBalanceCents)}
        </span>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Account
        <select
          className="select"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {showForm && (
        <form ref={formRef} className="card flex flex-col gap-3" onSubmit={submit}>
          <div className="text-sm font-semibold text-gray-700">
            {editingId !== null
              ? 'Edit transaction'
              : form.kind === 'transfer'
                ? 'Add transfer'
                : 'Add transaction'}
          </div>

          {/* One picker — a transfer is just another kind of transaction.
              Transfer is add-only (you can't convert an existing entry). */}
          <div className="flex gap-2">
            <button
              type="button"
              className={form.kind === 'credit' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
              onClick={() => setForm((f) => ({ ...f, kind: 'credit' }))}
            >
              Credit (in)
            </button>
            <button
              type="button"
              className={form.kind === 'debit' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
              onClick={() => setForm((f) => ({ ...f, kind: 'debit' }))}
            >
              Debit (out)
            </button>
            {editingId === null && (
              <button
                type="button"
                className={form.kind === 'transfer' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    kind: 'transfer',
                    // Seed From/To with sensible defaults the first time.
                    fromAccountId: f.fromAccountId === '' ? accounts[0]?.id ?? '' : f.fromAccountId,
                    toAccountId: f.toAccountId === '' ? accounts[1]?.id ?? '' : f.toAccountId,
                  }))
                }
              >
                Transfer
              </button>
            )}
          </div>

          {form.kind === 'transfer' ? (
            <>
              <label className="flex flex-col gap-1 text-sm font-medium">
                From account
                <select
                  className="select"
                  value={form.fromAccountId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fromAccountId: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                To account
                <select
                  className="select"
                  value={form.toAccountId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      toAccountId: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {form.fromAccountId !== '' && form.fromAccountId === form.toAccountId && (
                <p className="text-xs text-red-600">Choose two different accounts.</p>
              )}
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Account
                <select
                  className="select"
                  value={form.accountId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, accountId: e.target.value === '' ? '' : Number(e.target.value) }))
                  }
                  required
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium">
                Payee
                <input
                  className="input"
                  value={form.payee}
                  onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
                  required
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium">
            Date
            <input
              type="date"
              className="input"
              value={form.entryDate}
              onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Amount
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </label>

          {form.kind !== 'transfer' && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Category
              <select
                className="select"
                value={form.categoryId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, categoryId: e.target.value === '' ? '' : Number(e.target.value) }))
                }
              >
                <option value="">— none —</option>
                {(categories ?? [])
                  .filter((c) => !c.archived || c.id === form.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.groupName} · {c.name}
                      {c.archived ? ' (hidden)' : ''}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium">
            Note
            <input
              className="input"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </label>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={form.cleared}
              onChange={(e) => setForm((f) => ({ ...f, cleared: e.target.checked }))}
            />
            Cleared
          </label>

          <div className="flex gap-2">
            <button className="btn-primary flex-1" type="submit">
              {editingId === null ? 'Add' : 'Save'}
            </button>
            <button className="btn-secondary flex-1" type="button" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : display.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No transactions yet"
          message="Add your first transaction to start your ledger."
          cta={{ label: 'Add transaction', onClick: openAdd }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {weekGroups.map((g) => {
            // Select mode forces every group open: uncategorized entries are
            // mostly old ones, and bulk-selecting rows the user can't see or
            // deselect is worse than useless. Derived rather than written into
            // weekOverrides, so exiting select mode restores their own state.
            const expanded =
              selectMode || (weekOverrides[g.startDate] ?? g.startDate === defaultOpenStart);
            const listId = `week-${g.startDate}`;
            return (
              <section key={g.startDate} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:opacity-50"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  disabled={selectMode}
                  onClick={() => setWeekOverrides((prev) => ({ ...prev, [g.startDate]: !expanded }))}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {expanded ? (
                      <ChevronDown size={16} className="shrink-0 text-gray-500" aria-hidden="true" />
                    ) : (
                      <ChevronRight size={16} className="shrink-0 text-gray-500" aria-hidden="true" />
                    )}
                    <span className="truncate text-sm font-semibold">{weekLabel(g)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                    <span>
                      {g.entries.length} {g.entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                    <span className={`font-semibold tabular-nums ${amountColor(g.netCents)}`}>
                      {formatCents(g.netCents)}
                    </span>
                  </span>
                </button>
                <ul id={listId} className={expanded ? 'flex flex-col gap-2' : 'hidden'}>
                  {g.entries.map((e) => {
                    const cat = e.categoryId !== null ? catById.get(e.categoryId) : undefined;
                    const signed = e.direction === 'credit' ? e.amountCents : -e.amountCents;
                    return (
                      <li
                        key={e.id}
                        className={`card ${e.cleared ? '' : 'opacity-60'} ${
                          selectMode && selected.has(e.id) ? 'ring-2 ring-blue-400' : ''
                        }`}
                        onClick={selectMode ? () => toggleSelect(e.id) : undefined}
                      >
                        <div className="flex gap-2">
                          {selectMode && (
                            <input
                              type="checkbox"
                              className="mt-1 h-5 w-5 shrink-0"
                              checked={selected.has(e.id)}
                              onChange={() => toggleSelect(e.id)}
                              onClick={(ev) => ev.stopPropagation()}
                            />
                          )}
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate font-medium">{e.payee}</span>
                                  {e.source === 'imported' && (
                                    <span className="shrink-0 rounded bg-blue-100 px-1.5 text-xs text-blue-700">
                                      imported
                                    </span>
                                  )}
                                  {e.transferId && (
                                    <span className="shrink-0 rounded bg-purple-100 px-1.5 text-xs text-purple-700">
                                      transfer
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {e.entryDate}
                                  {accountFilter === '' && ` · ${acctById.get(e.accountId) ?? 'account'}`}
                                  {cat ? ` · ${cat.name}` : ' · Uncategorized'}
                                </div>
                              </div>
                              <div
                                className={`shrink-0 text-right font-semibold tabular-nums ${amountColor(signed)}`}
                              >
                                {formatCents(signed)}
                              </div>
                            </div>
                            {e.note && (
                              <div className="text-xs italic text-gray-500">{e.note}</div>
                            )}
                            {selectMode ? (
                              <div className="text-xs tabular-nums text-gray-500">
                                Bal{' '}
                                <span className={amountColor(e.runningBalanceCents)}>
                                  {formatCents(e.runningBalanceCents)}
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                  <button
                                    className="flex items-center gap-1.5 py-1.5"
                                    onClick={() =>
                                      toggle.mutate({
                                        id: e.id,
                                        cleared: !e.cleared,
                                        clearedDate: !e.cleared ? e.entryDate : null,
                                      })
                                    }
                                  >
                                    <span
                                      className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                                        e.cleared ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300'
                                      }`}
                                    >
                                      {e.cleared ? '✓' : ''}
                                    </span>
                                    {e.cleared ? 'Cleared' : 'Pending'}
                                  </button>
                                  <span className="tabular-nums">
                                    Bal{' '}
                                    <span className={amountColor(e.runningBalanceCents)}>
                                      {formatCents(e.runningBalanceCents)}
                                    </span>
                                  </span>
                                </div>
                                <div className="flex gap-2 pt-1">
                                  {/* Transfers are edited by deleting and re-creating, so
                                      the per-leg edit form is hidden for transfer rows. */}
                                  {!e.transferId && (
                                    <button className="btn-secondary py-1.5" onClick={() => openEdit(e)}>
                                      Edit
                                    </button>
                                  )}
                                  <button
                                    className="btn-danger py-1.5"
                                    onClick={() => {
                                      if (
                                        e.transferId &&
                                        !window.confirm('Delete this transfer? Both legs will be removed.')
                                      ) {
                                        return;
                                      }
                                      del.mutate(e.id);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {selectMode && (
        <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <button
              className="text-xs text-blue-600 underline"
              onClick={() =>
                setSelected(new Set(display.filter((e) => e.categoryId === null).map((e) => e.id)))
              }
            >
              Select all uncategorized
            </button>
          </div>
          <select
            className="select"
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— Set to: Uncategorized —</option>
            {(categories ?? [])
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.groupName} · {c.name}
                </option>
              ))}
          </select>
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              disabled={selected.size === 0 || bulkCategorize.isPending}
              onClick={applyBulk}
            >
              {bulkCategorize.isPending ? 'Applying…' : `Apply to ${selected.size}`}
            </button>
            <button className="btn-secondary flex-1" onClick={exitSelect}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
