import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, fromCents, formatCents, toISODate } from '@buddy/shared';
import {
  useCategoryHistory,
  useHistoryByCategory,
  type HistoryByCategory,
  type HistoryRange,
} from '../api/history.js';

/** Brand lavender, matching the Tailwind `brand` token used across the site. */
const BRAND = '#7c5fce';

/** Default range: the last 8 weeks (56 days), ending today. */
function defaultRange(): { from: string; to: string } {
  const to = toISODate(new Date());
  const from = addDays(to, -55);
  return { from, to };
}

export default function History() {
  const initial = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);

  const range: HistoryRange = { from, to };
  const { data, isLoading, isError } = useHistoryByCategory(range);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">History</h1>

      <section className="card flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Date range</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            From
            <input
              type="date"
              className="input"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            To
            <input
              type="date"
              className="input"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </section>

      {isLoading && <p className="text-gray-500">Loading…</p>}
      {isError && <p className="text-red-600">Could not load history.</p>}

      {data && <HistoryContent data={data} onSelectCategory={setSelectedCategory} />}

      {selectedCategory != null && (
        <CategoryTrend
          id={selectedCategory}
          range={range}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
}

/** Splits out the chart + table so the empty state is easy to detect. */
function HistoryContent({
  data,
  onSelectCategory,
}: {
  data: HistoryByCategory;
  onSelectCategory: (id: number) => void;
}) {
  const hasSpend = data.categories.some((c) => c.totalCents > 0);

  if (!hasSpend) {
    return <div className="card text-center text-gray-500">No spending recorded yet.</div>;
  }

  return (
    <>
      <SpendChart data={data} />
      <SpendTable data={data} onSelectCategory={onSelectCategory} />
      <p className="text-xs text-gray-400">Tap a category row to see its trend.</p>
    </>
  );
}

/** Bar chart: total expense spend per period across the range. */
function SpendChart({ data }: { data: HistoryByCategory }) {
  const chartData = data.periods.map((p, i) => ({
    label: p.label,
    total: fromCents(
      data.categories.reduce((sum, c) => sum + (c.perPeriodCents[i] ?? 0), 0),
    ),
  }));

  return (
    <section className="card">
      <h2 className="mb-2 text-lg font-semibold">Spend per period</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `$${v}`} />
          <Tooltip formatter={(v: number) => formatCents(Math.round(v * 100))} />
          <Bar dataKey="total" fill={BRAND} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

/**
 * Table: rows = categories (grouped), columns = periods, plus a total column.
 * Horizontal scroll keeps it readable on a phone. Rows are tappable to drill in
 * (the selected id is surfaced via a data attribute the parent reads on click).
 */
function SpendTable({
  data,
  onSelectCategory,
}: {
  data: HistoryByCategory;
  onSelectCategory: (id: number) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, HistoryByCategory['categories']>();
    for (const c of data.categories) {
      if (!map.has(c.groupName)) map.set(c.groupName, []);
      map.get(c.groupName)!.push(c);
    }
    return [...map.entries()];
  }, [data.categories]);

  return (
    <section className="card overflow-x-auto">
      <h2 className="mb-2 text-lg font-semibold">By category</h2>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="sticky left-0 z-10 bg-white px-2 py-1">Category</th>
            {data.periods.map((p) => (
              <th key={p.startDate} className="whitespace-nowrap px-2 py-1 text-right">
                {p.label}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, cats]) => (
            <GroupRows
              key={group}
              group={group}
              cats={cats}
              periodCount={data.periods.length}
              onSelectCategory={onSelectCategory}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GroupRows({
  group,
  cats,
  periodCount,
  onSelectCategory,
}: {
  group: string;
  cats: HistoryByCategory['categories'];
  periodCount: number;
  onSelectCategory: (id: number) => void;
}) {
  const groupTotals = useMemo(() => {
    const perPeriod = new Array(periodCount).fill(0);
    let total = 0;
    for (const c of cats) {
      for (let i = 0; i < periodCount; i += 1) perPeriod[i] += c.perPeriodCents[i] ?? 0;
      total += c.totalCents;
    }
    return { perPeriod, total };
  }, [cats, periodCount]);

  return (
    <>
      <tr className="bg-gray-50 text-xs font-semibold text-gray-700">
        <td className="sticky left-0 z-10 bg-gray-50 px-2 py-1">{group}</td>
        {groupTotals.perPeriod.map((cents, i) => (
          <td key={i} className="px-2 py-1 text-right">
            {cents ? formatCents(cents) : '—'}
          </td>
        ))}
        <td className="px-2 py-1 text-right">{formatCents(groupTotals.total)}</td>
      </tr>
      {cats.map((c) => (
        <tr
          key={c.categoryId}
          onClick={() => onSelectCategory(c.categoryId)}
          className="cursor-pointer border-t border-gray-100 hover:bg-brand/5"
        >
          <td className="sticky left-0 z-10 bg-white px-2 py-1 pl-4">{c.categoryName}</td>
          {c.perPeriodCents.map((cents, i) => (
            <td key={i} className="whitespace-nowrap px-2 py-1 text-right text-gray-700">
              {cents ? formatCents(cents) : '—'}
            </td>
          ))}
          <td className="px-2 py-1 text-right font-medium">{formatCents(c.totalCents)}</td>
        </tr>
      ))}
    </>
  );
}

/** Single-category trend, shown when a category row is tapped. */
function CategoryTrend({
  id,
  range,
  onClose,
}: {
  id: number;
  range: HistoryRange;
  onClose: () => void;
}) {
  const { data, isLoading } = useCategoryHistory(id, range);

  const chartData = (data?.points ?? []).map((p) => ({
    label: p.label,
    amount: fromCents(p.amountCents),
  }));

  return (
    <section className="card flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{data?.category.name ?? 'Category'} trend</h2>
        <button className="btn-secondary py-1.5" onClick={onClose}>
          Close
        </button>
      </div>
      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : chartData.every((d) => d.amount === 0) ? (
        <p className="text-gray-500">No spending in this range.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(v: number) => formatCents(Math.round(v * 100))} />
            <Bar dataKey="amount" fill={BRAND} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
