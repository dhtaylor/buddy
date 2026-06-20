import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Bill, BillOccurrence } from '@buddy/shared';
import { api } from './client.js';

export type BillWithOccurrences = Bill & { occurrences: BillOccurrence[] };

/** A bill occurrence joined with its bill's name/category, for week grouping. */
export type OccurrenceWithBill = {
  id: number;
  billId: number;
  dueDate: string;
  amountCents: number;
  paid: boolean;
  ledgerEntryId: number | null;
  billName: string;
  categoryId: number | null;
};

type BillInput = {
  name: string;
  categoryId?: number | null;
  recurrence: Bill['recurrence'];
  typicalDay?: number | null;
  note?: string | null;
};

type OccurrenceInput = { dueDate: string; amountCents: number };

export function useBills() {
  return useQuery<BillWithOccurrences[]>({
    queryKey: ['bills'],
    queryFn: () => api.get<BillWithOccurrences[]>('/bills'),
  });
}

export function useBillOccurrences(range?: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const qs = params.toString();
  return useQuery<OccurrenceWithBill[]>({
    queryKey: ['bills', 'occurrences', range?.from ?? null, range?.to ?? null],
    queryFn: () => api.get<OccurrenceWithBill[]>(`/bills/occurrences${qs ? `?${qs}` : ''}`),
  });
}

export function useCreateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BillInput) => api.post<Bill>('/bills', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useUpdateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: BillInput & { id: number }) =>
      api.put<Bill>(`/bills/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useDeleteBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/bills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useAddOccurrences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ billId, occurrences }: { billId: number; occurrences: OccurrenceInput[] }) =>
      api.post<BillOccurrence[]>(`/bills/${billId}/occurrences`, { occurrences }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useUpdateOccurrence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: { id: number; dueDate?: string; amountCents?: number; paid?: boolean }) =>
      api.put<BillOccurrence>(`/bills/occurrences/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['ledger', 'balance'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}

export function usePayOccurrence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountId }: { id: number; accountId: number }) =>
      api.post<BillOccurrence>(`/bills/occurrences/${id}/pay`, { accountId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['ledger', 'balance'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
    },
  });
}
