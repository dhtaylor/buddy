import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BalanceSummary, EntryDirection, LedgerEntry } from '@buddy/shared';
import { api } from './client.js';

/** A ledger entry plus its per-account cumulative running balance. */
export interface LedgerEntryWithBalance extends LedgerEntry {
  runningBalanceCents: number;
}

export interface LedgerParams {
  accountId?: number;
  from?: string;
  to?: string;
}

export type LedgerBalance = BalanceSummary;

export interface LedgerEntryInput {
  accountId: number;
  entryDate: string;
  payee: string;
  categoryId?: number | null;
  amountCents: number;
  direction: EntryDirection;
  cleared?: boolean;
  clearedDate?: string | null;
  note?: string | null;
}

function toQueryString(params: LedgerParams): string {
  const sp = new URLSearchParams();
  if (params.accountId !== undefined) sp.set('accountId', String(params.accountId));
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/** Invalidate every query whose data depends on the ledger. */
function invalidateLedger(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['ledger'] });
  qc.invalidateQueries({ queryKey: ['ledger', 'balance'] });
  qc.invalidateQueries({ queryKey: ['budget'] });
  qc.invalidateQueries({ queryKey: ['history'] });
}

export function useLedger(params: LedgerParams = {}) {
  return useQuery<LedgerEntryWithBalance[]>({
    queryKey: ['ledger', params],
    queryFn: () => api.get<LedgerEntryWithBalance[]>(`/ledger${toQueryString(params)}`),
  });
}

export function useLedgerBalance() {
  return useQuery<LedgerBalance>({
    queryKey: ['ledger', 'balance'],
    queryFn: () => api.get<LedgerBalance>('/ledger/balance'),
  });
}

export function useCreateLedgerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LedgerEntryInput) => api.post<LedgerEntry>('/ledger', input),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useUpdateLedgerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: LedgerEntryInput & { id: number }) =>
      api.put<LedgerEntry>(`/ledger/${id}`, input),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useDeleteLedgerEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/ledger/${id}`),
    onSuccess: () => invalidateLedger(qc),
  });
}

/** Set the same category on many entries at once. categoryId null = clear it. */
export function useBulkCategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, categoryId }: { ids: number[]; categoryId: number | null }) =>
      api.post<{ updated: number }>('/ledger/bulk-categorize', { ids, categoryId }),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useToggleCleared() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      cleared,
      clearedDate,
    }: {
      id: number;
      cleared: boolean;
      clearedDate?: string | null;
    }) => api.put<LedgerEntry>(`/ledger/${id}/cleared`, { cleared, clearedDate }),
    onSuccess: () => invalidateLedger(qc),
  });
}
