import { useState } from 'react';
import {
  addDays,
  formatCents,
  parseCents,
  periodFor,
} from '@buddy/shared';
import type { CategoryKind } from '@buddy/shared';
import { PieChart } from 'lucide-react';
import EmptyState from '../components/EmptyState.js';
import { SkeletonCard } from '../components/Skeleton.js';
import { useHousehold } from '../api/household.js';
import { useCreateCategory, useSetCategoryArchived } from '../api/categories.js';
import {
  useBudget,
  useUpsertBudgetLine,
  type BudgetLineView,
} from '../api/budget.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Budget() {
  const [date, setDate] = useState(today());
  const household = useHousehold();
  const budget = useBudget(date);
  const upsert = useUpsertBudgetLine();
  const createCategory = useCreateCategory();
  const setArchived = useSetCategoryArchived();

  const existingGroups = budget.data?.groups.map((g) => g.groupName) ?? [];

  // Move the picker by one whole period using the household's configured length.
  const step = (dir: -1 | 1) => {
    const hh = household.data;
    if (!hh) return;
    const period = periodFor(date, hh.periodLength, hh.periodAnchorDate, hh.periodCustomDays ?? undefined);
    setDate(dir === 1 ? addDays(period.endDate, 1) : addDays(period.startDate, -1));
  };

  const label = budget.data?.period.label ?? '…';

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Budget</h1>

      <div className="flex items-center justify-between gap-2">
        <button className="btn-secondary py-2" onClick={() => step(-1)} aria-label="Previous period">
          ‹ Prev
        </button>
        <div className="text-center text-sm font-semibold">{label}</div>
        <button className="btn-secondary py-2" onClick={() => step(1)} aria-label="Next period">
          Next ›
        </button>
      </div>

      {budget.isLoading && (
        <div className="flex flex-col gap-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {budget.isError && (
        <div className="text-center text-red-600">Failed to load budget.</div>
      )}

      {budget.data && (
        <>
          {budget.data.groups.length === 0 && (
            <EmptyState
              icon={PieChart}
              title="No budget items yet"
              message="Add your first item below to start planning this period."
            />
          )}

          {budget.data.groups.map((group) => (
            <section key={group.groupName} className="card flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{group.groupName}</h2>
              <ul className="flex flex-col gap-2">
                {group.lines.map((line) => (
                  <LineRow
                    key={line.categoryId}
                    line={line}
                    onSave={(plannedCents, dueDate) =>
                      upsert.mutate({
                        periodId: budget.data!.period.id,
                        categoryId: line.categoryId,
                        plannedCents,
                        dueDate,
                      })
                    }
                    onHide={() => {
                      if (
                        confirm(
                          `Hide "${line.categoryName}"? Its past transactions and History stay; ` +
                            `it just won't show on the Budget page. You can unhide it in Settings.`,
                        )
                      ) {
                        setArchived.mutate({ id: line.categoryId, archived: true });
                      }
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}

          <AddItemForm
            groups={existingGroups}
            onAdd={(input) => createCategory.mutate(input)}
            pending={createCategory.isPending}
          />

          <TotalsFooter totals={budget.data.totals} />
        </>
      )}
    </div>
  );
}

function AddItemForm({
  groups,
  onAdd,
  pending,
}: {
  groups: string[];
  onAdd: (input: { groupName: string; name: string; kind: CategoryKind }) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [groupChoice, setGroupChoice] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');

  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        + Add budget item
      </button>
    );
  }

  const groupName = groupChoice === '__new__' ? newGroup.trim() : groupChoice;
  const canAdd = groupName !== '' && name.trim() !== '';

  return (
    <form
      className="card flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canAdd) return;
        onAdd({ groupName, name: name.trim(), kind });
        setName('');
        setNewGroup('');
        setOpen(false);
      }}
    >
      <div className="text-sm font-semibold text-gray-700">Add budget item</div>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Group
        <select
          className="select"
          value={groupChoice}
          onChange={(e) => setGroupChoice(e.target.value)}
          required
        >
          <option value="">Choose a group…</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value="__new__">+ New group…</option>
        </select>
      </label>
      {groupChoice === '__new__' && (
        <input
          className="input"
          placeholder="New group name (e.g. Utilities)"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          required
        />
      )}
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Item name
        <input
          className="input"
          placeholder="e.g. Groceries"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Type
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </label>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" type="submit" disabled={!canAdd || pending}>
          Add
        </button>
        <button className="btn-secondary flex-1" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LineRow({
  line,
  onSave,
  onHide,
}: {
  line: BudgetLineView;
  onSave: (plannedCents: number, dueDate: string | null) => void;
  onHide: () => void;
}) {
  const [planned, setPlanned] = useState(
    line.plannedCents ? formatCents(line.plannedCents).replace('$', '') : '',
  );
  const [dueDate, setDueDate] = useState(line.dueDate ?? '');

  // The synthetic "Uncategorized" line (categoryId 0) isn't a real category — it
  // can't be planned, given a due date, or hidden. Show it read-only with a nudge.
  if (line.categoryId === 0) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2">
        <div>
          <div className="font-medium text-amber-900">Uncategorized</div>
          <div className="text-xs text-amber-700">Categorize these in the Ledger</div>
        </div>
        <span className="text-sm font-semibold text-red-600">{formatCents(line.actualCents)}</span>
      </li>
    );
  }

  const commitPlanned = () => {
    const cents = planned.trim() === '' ? 0 : parseCents(planned) ?? 0;
    if (cents !== line.plannedCents) onSave(cents, dueDate || null);
  };
  const commitDue = (value: string) => {
    setDueDate(value);
    const cents = planned.trim() === '' ? 0 : parseCents(planned) ?? 0;
    onSave(cents, value || null);
  };

  return (
    <li className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {line.categoryName}
          {line.kind === 'income' && (
            <span className="ml-2 rounded bg-green-100 px-1.5 text-xs text-green-700">income</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${line.overBudget ? 'text-red-600' : 'text-gray-700'}`}>
            {formatCents(line.actualCents)}
          </span>
          <button
            type="button"
            className="text-xs text-gray-400 underline"
            onClick={onHide}
            aria-label={`Hide ${line.categoryName}`}
          >
            Hide
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex flex-1 flex-col gap-0.5 text-xs text-gray-500">
          Planned
          <input
            className="input py-1.5"
            inputMode="decimal"
            placeholder="0.00"
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            onBlur={commitPlanned}
          />
        </label>
        <label className="flex flex-1 flex-col gap-0.5 text-xs text-gray-500">
          Due date
          <input
            type="date"
            className="input py-1.5"
            value={dueDate}
            onChange={(e) => commitDue(e.target.value)}
          />
        </label>
      </div>
    </li>
  );
}

function TotalsFooter({
  totals,
}: {
  totals: {
    incomePlannedCents: number;
    expensePlannedCents: number;
    expenseActualCents: number;
    overByCents: number;
  };
}) {
  const over = totals.overByCents > 0;
  return (
    <section className="card flex flex-col gap-1">
      <Row label="Income (planned)" value={formatCents(totals.incomePlannedCents)} />
      <Row label="Projected (expense planned)" value={formatCents(totals.expensePlannedCents)} />
      <Row
        label="Actual (expense)"
        value={formatCents(totals.expenseActualCents)}
        red={over}
      />
      {over && (
        <Row label="Over budget by" value={formatCents(totals.overByCents)} red />
      )}
    </section>
  );
}

function Row({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`font-semibold ${red ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
