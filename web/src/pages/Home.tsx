import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { addDays, formatCents, periodFor, type HelocSummary } from '@buddy/shared';
import EmptyState from '../components/EmptyState.js';
import { Skeleton } from '../components/Skeleton.js';
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

  // HELOC cash-sweep view (admin-toggled). Scope swept/drawn to the selected period
  // so the stepper re-scopes the card the same way it re-scopes the budget summary.
  const hh = household.data;
  const helocEnabled = !!hh?.helocStrategyEnabled;
  const currentPeriod = hh
    ? periodFor(date, hh.periodLength, hh.periodAnchorDate, hh.periodCustomDays ?? undefined)
    : undefined;
  const heloc = useHelocSummary(currentPeriod?.startDate, currentPeriod?.endDate, helocEnabled);
  const showHeloc = helocEnabled && (heloc.data?.length ?? 0) > 0;

  if (accountsLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <EmptyState
          icon={Wallet}
          title="Welcome to Buddy"
          message="Add an account to get started tracking your household's money."
          cta={{ label: 'Go to Settings', to: '/settings' }}
        />
        <Link to="/guide" className="-mt-4 text-sm text-brand underline">
          New here? Read the getting-started guide
        </Link>
      </div>
    );
  }

  const overBudget =
    summary.data !== undefined && summary.data.expenseActualCents > summary.data.expensePlannedCents;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Period navigation — governs the HELOC sweep totals and the budget summary below. */}
      <div className="flex items-center justify-between gap-2">
        <button className="btn-secondary py-2" onClick={() => step(-1)} aria-label="Previous week">
          ‹ Prev
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold">{summary.data?.period.label ?? '…'}</div>
          {isCurrentWeek ? (
            <div className="text-xs text-gray-400">This week</div>
          ) : (
            <button className="text-xs text-blue-600 underline" onClick={() => setDate(today())}>
              Jump to this week
            </button>
          )}
        </div>
        <button className="btn-secondary py-2" onClick={() => step(1)} aria-label="Next week">
          Next ›
        </button>
      </div>

      <h1 className="text-2xl font-bold">Home</h1>

      {/* Running balance */}
      <div
        className={`flex flex-col gap-2 ${
          showHeloc
            ? 'card'
            : 'rounded-xl bg-gradient-to-br from-brand to-brand-dark p-4 text-white shadow-sm'
        }`}
      >
        <div className={`text-sm font-medium ${showHeloc ? 'text-gray-600' : 'text-white/80'}`}>
          {showHeloc ? 'Cash & net position' : 'Running balance'}
        </div>
        {balance.isLoading ? (
          showHeloc ? (
            <Skeleton className="h-8 w-32" />
          ) : (
            <div className="h-9 w-36 animate-pulse rounded-md bg-white/25" aria-hidden="true" />
          )
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
              <div className="text-4xl font-bold tabular-nums">
                {formatCents(balance.data?.recordedCents ?? 0)}
              </div>
              <div className="text-xs text-white/70">Recorded</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-semibold tabular-nums text-white/90">
                {formatCents(balance.data?.clearedCents ?? 0)}
              </div>
              <div className="text-xs text-white/70">Cleared</div>
            </div>
          </div>
        )}
      </div>

      {/* HELOC cash-sweep cards */}
      {showHeloc && heloc.data?.map((h) => <HelocCard key={h.accountId} h={h} />)}

      {/* Weekly summary */}
      <div>
        {summary.isLoading ? (
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
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
        <span className="rounded bg-brand/10 px-1.5 text-xs font-medium text-brand">HELOC</span>
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
            <div className="h-full rounded bg-brand" style={{ width: `${paidDownPct}%` }} />
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
        <div className="rounded-lg bg-brand/5 px-3 py-2 ring-1 ring-brand/20">
          <div className="text-xs text-brand">Interest saved this period by sweeping</div>
          <div className="text-2xl font-bold tabular-nums text-brand">
            {formatCents(h.interestSavedCents)}
          </div>
          {h.periodInterestCents !== null && (
            <div className="mt-0.5 text-xs text-brand/80">
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
