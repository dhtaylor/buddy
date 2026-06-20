import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

/** A single category row within the budget view. Actual is server-derived. */
export interface BudgetLineView {
  categoryId: number;
  categoryName: string;
  kind: 'income' | 'expense';
  plannedCents: number;
  dueDate: string | null;
  actualCents: number;
  overBudget: boolean;
}

export interface BudgetGroup {
  groupName: string;
  lines: BudgetLineView[];
}

export interface BudgetTotals {
  incomePlannedCents: number;
  expensePlannedCents: number;
  incomeActualCents: number;
  expenseActualCents: number;
  overByCents: number;
}

export interface BudgetView {
  period: { id: number; startDate: string; endDate: string; label: string };
  groups: BudgetGroup[];
  totals: BudgetTotals;
}

export interface BudgetSummary extends BudgetTotals {
  period: { startDate: string; endDate: string; label: string };
}

function withDate(path: string, date?: string): string {
  return date ? `${path}?date=${date}` : path;
}

export function useBudget(date?: string) {
  return useQuery<BudgetView>({
    queryKey: ['budget', date],
    queryFn: () => api.get<BudgetView>(withDate('/budget', date)),
  });
}

export function useBudgetSummary(date?: string) {
  return useQuery<BudgetSummary>({
    queryKey: ['budget', 'summary', date],
    queryFn: () => api.get<BudgetSummary>(withDate('/budget/summary', date)),
  });
}

export interface UpsertBudgetLineInput {
  periodId: number;
  categoryId: number;
  plannedCents: number;
  dueDate?: string | null;
}

export function useUpsertBudgetLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertBudgetLineInput) => api.put('/budget/line', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}
