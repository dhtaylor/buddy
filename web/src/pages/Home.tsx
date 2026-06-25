import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, formatCents, periodFor, type HelocSummary } from '@buddy/shared';
import { useAccounts, useHelocSummary } from '../api/accounts.js';
import { useHousehold } from '../api/household.js';
import { useLedgerBalance } from '../api/ledger.js';
import { useBudgetSummary } from '../api/budget.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const [date, setDate] = useState(today());
  const household = useHousehold();
  const balance = useLedgerBalance();
  const summary = useBudgetSummary(date);

  // Step by one whole period using the household's configured length (matches Budget).
  const step = (dir: -1 | 1) => {
    const hh = household.data;
    if (!hh) return;
    const period = periodFor(date, hh.periodLength, hh.periodAnchorDate, hh.periodCustomDays ?? undefined);
    setDate(dir === 1 ? addDays(period.endDate, 1) : addDays(period.startDate, -1));
  };

  const todayStr = today();
  const isCurrentWeek =
    !!summary.data && todayStr >= summary.data.period.startDate && todayStr <= summary.data.period.endDate;

  // HELOC cash-sweep view (admin-toggled). Scope swept/drawn to the current period.
  const hh = household.data;
  const helocEnabled = !!hh?.helocStrategyEnabled;
  const currentPeriod = hh
    ? periodFor(todayStr, hh.periodLength, hh.periodAnchorDate, hh.periodCustomDays ?? undefined)
    : undefined;
  const heloc = useHelocSummary(currentPeriod?.startDate, currentPeriod?.endDate, helocEnabled);
  const showHeloc = helocEnabled && (heloc.data?.length ?? 0) > 0;

  if (accountsLoading) {
    return <p className="p-8 text-center text-gray-500">Loading…</p>;
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-gray-500">
        <h1 className="text-2xl font-semibold text-gray-700">Welcome to Buddy</h1>
        <p>Add an account to get started.</p>
        <Link to="/settings" className="btn-primary">
          Go to Settings
        </Link>
      </div>
    );
  }

  const overBudget =
    summary.data !== undefined && summary.data.expenseActualCents > summary.data.expensePlannedCents;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Home</h1>

      {/* Running balance */}
      <div className="card flex flex-col gap-2">
        <div className="text-sm font-medium text-gray-600">
          {showHeloc ? 'Cash & net position' : 'Running balance'}
        </div>
        {balance.isLoading ? (
          <div className="text-gray-400">Loading…</div>
        ) : showHeloc ? (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold tabular-nums">
                {formatCents(balance.data?.assetsCents ?? 0)}
              </div>
              <div className="text-xs text-gray-500">Cash on hand</div>
            </div>
            <div className="text-right">
              <div
                className={`text-xl font-semibold tabular-nums ${
                  (balance.data?.netCents ?? 0) < 0 ? 'text-red-600' : 'text-gray-700'
                }`}
              >
                {formatCents(balance.data?.netCents ?? 0)}
              </div>
              <div className="text-xs text-gray-500">Net (after HELOC)</div>
            </div>
          </div>
        ) : (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold tabular-nums">
                {formatCents(balance.data?.recordedCents ?? 0)}
              </div>
              <div className="text-xs text-gray-500">Recorded</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold tabular-nums text-gray-700">
                {formatCents(balance.data?.clearedCents ?? 0)}
              </div>
              <div className="text-xs text-gray-500">Cleared</div>
            </div>
          </div>
        )}
      </div>

      {/* HELOC cash-sweep cards */}
      {showHeloc && heloc.data?.map((h) => <HelocCard key={h.accountId} h={h} />)}

      {/* Weekly summary with period navigation */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <button className="btn-secondary py-2" onClick={() => step(-1)} aria-label="Previous week">
            ‹ Prev
          </button>
          <div className="text-center">
            <div className="text-sm font-semibold">{summary.data?.period.label ?? '…'}</div>
            {isCurrentWeek ? (
              <div className="text-xs text-gray-400">This week</div>
            ) : (
              <button
                className="text-xs text-blue-600 underline"
                onClick={() => setDate(today())}
              >
                Jump to this week
              </button>
            )}
          </div>
          <button className="btn-secondary py-2" onClick={() => step(1)} aria-label="Next week">
            Next ›
          </button>
        </div>
        {summary.isLoading ? (
          <p className="text-gray-400">Loading…</p>
        ) : summary.isError || !summary.data ? (
          <p className="text-sm text-gray-500">Budget summary unavailable.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <div className="card flex flex-col gap-1">
              <div className="text-xs text-gray-500">Income</div>
              <div className="text-lg font-semibold tabular-nums text-green-700">
                {formatCents(summary.data.incomeActualCents)}
              </div>
            </div>
            <div className="card flex flex-col gap-1">
              <div className="text-xs text-gray-500">Projected</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCents(summary.data.expensePlannedCents)}
              </div>
            </div>
            <div className={`card flex flex-col gap-1 ${overBudget ? 'bg-red-50 ring-1 ring-red-300' : ''}`}>
              <div className="text-xs text-gray-500">Actual</div>
              <div
                className={`text-lg font-semibold tabular-nums ${overBudget ? 'text-red-600' : ''}`}
              >
                {formatCents(summary.data.expenseActualCents)}
              </div>
            </div>
          </div>
        )}
      </div>

      <Link to="/ledger" className="btn-primary text-center">
        Add transaction
      </Link>
    </div>
  );
}

function HelocCard({ h }: { h: HelocSummary }) {
  // Share of the limit that is paid down (i.e. still available to borrow).
  const paidDownPct =
    h.creditLimitCents > 0 ? Math.round((h.availableCents / h.creditLimitCents) * 100) : 0;

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-700">{h.name}</div>
        <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700">HELOC</span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-bold tabular-nums text-red-600">
            {formatCents(h.owedCents)}
          </div>
          <div className="text-xs text-gray-500">Balance owed</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums text-green-700">
            {formatCents(h.availableCents)}
          </div>
          <div className="text-xs text-gray-500">Available credit</div>
        </div>
      </div>

      {h.creditLimitCents > 0 && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
            <div className="h-full rounded bg-green-500" style={{ width: `${paidDownPct}%` }} />
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {paidDownPct}% of {formatCents(h.creditLimitCents)} limit available
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded bg-green-50 px-3 py-2">
          <div className="text-xs text-gray-500">Swept this period</div>
          <div className="text-lg font-semibold tabular-nums text-green-700">
            +{formatCents(h.sweptCents)}
          </div>
        </div>
        <div className="rounded bg-red-50 px-3 py-2">
          <div className="text-xs text-gray-500">Drawn this period</div>
          <div className="text-lg font-semibold tabular-nums text-red-600">
            -{formatCents(h.drawnCents)}
          </div>
        </div>
      </div>

      {h.interestSavedCents !== null && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-emerald-200">
          <div className="text-xs text-emerald-700">Interest saved this period by sweeping</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-700">
            {formatCents(h.interestSavedCents)}
          </div>
          {h.periodInterestCents !== null && (
            <div className="mt-0.5 text-xs text-emerald-700/80">
              Accrued {formatCents(h.periodInterestCents)} vs.{' '}
              {formatCents(h.periodInterestCents + h.interestSavedCents)} without the sweep
            </div>
          )}
        </div>
      )}

      {h.estMonthlyInterestCents !== null && (
        <div className="text-xs text-gray-500">
          Est. interest this month at current balance:{' '}
          <span className="font-semibold text-gray-700">
            {formatCents(h.estMonthlyInterestCents)}
          </span>
          {h.aprBps !== null && <> ({(h.aprBps / 100).toFixed(2)}% APR)</>}
        </div>
      )}
    </div>
  );
}
