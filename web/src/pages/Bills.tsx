import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatCents,
  parseCents,
  periodLabel,
  toISODate,
  weeklyPeriod,
  type Bill,
} from '@buddy/shared';
import { useAccounts } from '../api/accounts.js';
import { useCategories } from '../api/categories.js';
import {
  useAddOccurrences,
  useBillOccurrences,
  useBills,
  useCreateBill,
  useDeleteBill,
  usePayOccurrence,
  useUpdateOccurrence,
  type OccurrenceWithBill,
} from '../api/bills.js';

export default function Bills() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold">Bills</h1>
      <UpcomingSection />
      <BillsListSection />
      <AddBillForm />
    </div>
  );
}

// --- Upcoming occurrences grouped by Sun–Sat week ---
function UpcomingSection() {
  const { data, isLoading } = useBillOccurrences();

  const weeks = useMemo(() => {
    const map = new Map<string, { label: string; items: OccurrenceWithBill[] }>();
    for (const occ of data ?? []) {
      const week = weeklyPeriod(occ.dueDate);
      const key = week.startDate;
      if (!map.has(key)) map.set(key, { label: periodLabel(week), items: [] });
      map.get(key)!.items.push(occ);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Upcoming</h2>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : weeks.length === 0 ? (
        <p className="text-sm text-gray-500">No upcoming bills.</p>
      ) : (
        weeks.map(([key, week]) => (
          <div key={key} className="flex flex-col gap-2">
            <div className="text-sm font-semibold text-gray-700">{week.label}</div>
            <ul className="flex flex-col gap-2">
              {week.items.map((occ) => (
                <OccurrenceRow key={occ.id} occ={occ} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function OccurrenceRow({ occ }: { occ: OccurrenceWithBill }) {
  const { data: accounts } = useAccounts();
  const update = useUpdateOccurrence();
  const pay = usePayOccurrence();

  function handlePay() {
    const list = accounts ?? [];
    if (list.length === 0) {
      window.alert('Add an account in Settings first.');
      return;
    }
    const prompt = `Pay "${occ.billName}" ${formatCents(occ.amountCents)} from which account?\n${list
      .map((a, i) => `${i + 1}. ${a.name}`)
      .join('\n')}`;
    const answer = window.prompt(prompt, '1');
    if (answer == null) return;
    const idx = Number(answer) - 1;
    const account = list[idx];
    if (!account) {
      window.alert('Invalid account number.');
      return;
    }
    pay.mutate({ id: occ.id, accountId: account.id });
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-medium">{occ.billName}</div>
        <div className="text-xs text-gray-500">{formatCents(occ.amountCents)}</div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          className="input w-36 py-1.5"
          value={occ.dueDate}
          onChange={(e) => update.mutate({ id: occ.id, dueDate: e.target.value })}
          aria-label="Due date"
        />
        {occ.paid ? (
          <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700">Paid</span>
        ) : (
          <button className="btn-primary py-1.5" onClick={handlePay} disabled={pay.isPending}>
            Mark paid
          </button>
        )}
      </div>
    </li>
  );
}

// --- All bills, with a Split action ---
function BillsListSection() {
  const { data: bills, isLoading } = useBills();
  const del = useDeleteBill();

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Your bills</h2>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !bills || bills.length === 0 ? (
        <p className="text-sm text-gray-500">No bills yet. Add one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bills.map((b) => (
            <li key={b.id} className="flex flex-col gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-gray-500">
                    {b.recurrence}
                    {b.typicalDay != null && ` · day ${b.typicalDay}`}
                  </div>
                </div>
                <button className="btn-danger" onClick={() => del.mutate(b.id)}>
                  Delete
                </button>
              </div>
              <SplitForm bill={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Split a bill into two occurrences (e.g. two halves of a monthly bill).
function SplitForm({ bill }: { bill: Bill }) {
  const add = useAddOccurrences();
  const [open, setOpen] = useState(false);
  const today = toISODate(new Date());
  const [date1, setDate1] = useState(today);
  const [amount1, setAmount1] = useState('');
  const [date2, setDate2] = useState(today);
  const [amount2, setAmount2] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  // Bring the whole expanded form into view when opened from a bill far down the list.
  useEffect(() => {
    if (open) formRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [open]);

  if (!open) {
    return (
      <button className="btn-secondary self-start py-1.5" onClick={() => setOpen(true)}>
        Split
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-2 border-t border-gray-100 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        const c1 = parseCents(amount1);
        const c2 = parseCents(amount2);
        if (c1 == null || c2 == null) {
          window.alert('Enter valid amounts for both halves.');
          return;
        }
        add.mutate(
          {
            billId: bill.id,
            occurrences: [
              { dueDate: date1, amountCents: c1 },
              { dueDate: date2, amountCents: c2 },
            ],
          },
          {
            onSuccess: () => {
              setOpen(false);
              setAmount1('');
              setAmount2('');
            },
          },
        );
      }}
    >
      <div className="text-xs font-medium text-gray-600">Split into two halves</div>
      <div className="flex gap-2">
        <input
          type="date"
          className="input py-1.5"
          value={date1}
          onChange={(e) => setDate1(e.target.value)}
        />
        <input
          className="input py-1.5"
          placeholder="Half 1 (e.g. 359.07)"
          value={amount1}
          onChange={(e) => setAmount1(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <input
          type="date"
          className="input py-1.5"
          value={date2}
          onChange={(e) => setDate2(e.target.value)}
        />
        <input
          className="input py-1.5"
          placeholder="Half 2 (e.g. 359.08)"
          value={amount2}
          onChange={(e) => setAmount2(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary py-1.5" disabled={add.isPending}>
          Add halves
        </button>
        <button type="button" className="btn-secondary py-1.5" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// --- Add a new bill ---
function AddBillForm() {
  const { data: categories } = useCategories();
  const create = useCreateBill();

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [recurrence, setRecurrence] = useState<Bill['recurrence']>('monthly');
  const [typicalDay, setTypicalDay] = useState('');
  const [note, setNote] = useState('');

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Add a bill</h2>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            {
              name,
              categoryId: categoryId ? Number(categoryId) : null,
              recurrence,
              typicalDay: typicalDay ? Number(typicalDay) : null,
              note: note || null,
            },
            {
              onSuccess: () => {
                setName('');
                setCategoryId('');
                setRecurrence('monthly');
                setTypicalDay('');
                setNote('');
              },
            },
          );
        }}
      >
        <input
          className="input"
          placeholder="Bill name (e.g. Progressive)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select
          className="select"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">No category</option>
          {categories?.filter((c) => !c.archived).map((c) => (
            <option key={c.id} value={c.id}>
              {c.groupName} · {c.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as Bill['recurrence'])}
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Biweekly</option>
          <option value="yearly">Yearly</option>
          <option value="custom">Custom</option>
        </select>
        <input
          type="number"
          min={1}
          max={31}
          className="input"
          placeholder="Typical day of month (optional)"
          value={typicalDay}
          onChange={(e) => setTypicalDay(e.target.value)}
        />
        <input
          className="input"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn-primary" disabled={create.isPending}>
          Add bill
        </button>
      </form>
    </section>
  );
}
