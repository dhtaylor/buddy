import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export interface HistoryPeriod {
  startDate: string;
  endDate: string;
  label: string;
}

export interface HistoryCategory {
  categoryId: number;
  categoryName: string;
  groupName: string;
  totalCents: number;
  /** Aligned to the `periods` array. */
  perPeriodCents: number[];
}

export interface HistoryByCategory {
  periods: HistoryPeriod[];
  categories: HistoryCategory[];
  totalsByGroup: { groupName: string; totalCents: number }[];
  /** Budgeted (planned) expense total per period, aligned to `periods`. */
  plannedPerPeriodCents: number[];
}

export interface CategoryHistoryPoint {
  label: string;
  startDate: string;
  endDate: string;
  amountCents: number;
  /** Budgeted (planned) amount for this category in the period. */
  plannedCents: number;
}

export interface CategoryHistory {
  category: { id: number; name: string };
  points: CategoryHistoryPoint[];
}

export interface HistoryRange {
  from?: string;
  to?: string;
}

function rangeQuery(range?: HistoryRange): string {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useHistoryByCategory(range?: HistoryRange) {
  return useQuery<HistoryByCategory>({
    queryKey: ['history', 'by-category', range ?? null],
    queryFn: () => api.get<HistoryByCategory>(`/history/by-category${rangeQuery(range)}`),
  });
}

export function useCategoryHistory(id: number, range?: HistoryRange) {
  return useQuery<CategoryHistory>({
    queryKey: ['history', 'category', id, range ?? null],
    queryFn: () => api.get<CategoryHistory>(`/history/category/${id}${rangeQuery(range)}`),
    enabled: Number.isFinite(id),
  });
}
