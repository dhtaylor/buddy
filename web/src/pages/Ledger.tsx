import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCents, parseCents, type Category, type EntryDirection } from '@buddy/shared';
import { useAccounts } from '../api/accounts.js';
import { useCategories } from '../api/categories.js';
import {
  useBulkCategorize,
  useCreateLedgerEntry,
  useDeleteLedgerEntry,
  useLedger,
  useToggleCleared,
  useUpdateLedgerEntry,
  type LedgerEntryInput,
  type LedgerEntryWithBalance,
} from '../api/ledger.js';

/** Local calendar "today" as ISO YYYY-MM-DD (avoids UTC off-by-one). */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type FormState = {
  accountId: number | '';
  entryDate: string;
  payee: string;
  categoryId: number | '';
  amount: string;
  direction: EntryDirection;
  cleared: boolean;
  note: string;
};

function emptyForm(accountId: number | ''): FormState {
  return {
    accountId,
    entryDate: todayISO(),
    payee: '',
    categoryId: '',
    amount: '',
    direction: 'debit',
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
      accountId: e.accountId,
      entryDate: e.entryDate,
      payee: e.payee,
      categoryId: e.categoryId ?? '',
      amount: formatCents(e.amountCents).replace('$', ''),
      direction: e.direction,
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
    if (form.accountId === '') return;
    const cents = parseCents(form.amount);
    if (cents === null || cents < 0) return;
    const input: LedgerEntryInput = {
      accountId: form.accountId,
      entryDate: form.entryDate,
      payee: form.payee,
      categoryId: form.categoryId === '' ? null : form.categoryId,
      amountCents: cents,
      direction: form.direction,
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
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-gray-500">
        <h1 className="text-2xl font-semibold text-gray-700">Ledger</h1>
        <p>You need an account first. Add one in Settings.</p>
      </div>
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
        <span className="text-2xl font-bold tabular-nums">{formatCents(currentBalanceCents)}</span>
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
            {editingId === null ? 'Add transaction' : 'Edit transaction'}
          </div>

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

          <div className="flex gap-2">
            <button
              type="button"
              className={form.direction === 'debit' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
              onClick={() => setForm((f) => ({ ...f, direction: 'debit' }))}
            >
              Debit (out)
            </button>
            <button
              type="button"
              className={form.direction === 'credit' ? 'btn-primary flex-1' : 'btn-secondary flex-1'}
              onClick={() => setForm((f) => ({ ...f, direction: 'credit' }))}
            >
              Credit (in)
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Payee
            <input
              className="input"
              value={form.payee}
              onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
              required
            />
          </label>

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
        <p className="p-4 text-center text-gray-500">Loading…</p>
      ) : display.length === 0 ? (
        <p className="p-4 text-center text-gray-500">No transactions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {display.map((e) => {
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
                        </div>
                        <div className="text-xs text-gray-500">
                          {e.entryDate}
                          {accountFilter === '' && ` · ${acctById.get(e.accountId) ?? 'account'}`}
                          {cat ? ` · ${cat.name}` : ' · Uncategorized'}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 text-right font-semibold tabular-nums ${
                          signed < 0 ? 'text-gray-800' : 'text-green-700'
                        }`}
                      >
                        {formatCents(signed)}
                      </div>
                    </div>
                    {selectMode ? (
                      <div className="text-xs tabular-nums text-gray-500">
                        Bal {formatCents(e.runningBalanceCents)}
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
                          <span className="tabular-nums">Bal {formatCents(e.runningBalanceCents)}</span>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button className="btn-secondary py-1.5" onClick={() => openEdit(e)}>
                            Edit
                          </button>
                          <button className="btn-danger py-1.5" onClick={() => del.mutate(e.id)}>
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
