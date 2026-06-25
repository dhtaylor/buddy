import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account, HelocSummary } from '@buddy/shared';
import { api } from './client.js';

type AccountInput = {
  name: string;
  type: Account['type'];
  openingBalanceCents: number;
  creditLimitCents?: number;
  aprBps?: number | null;
};

export function useAccounts() {
  return useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => api.get<Account[]>('/accounts'),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountInput) => api.post<Account>('/accounts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AccountInput & { id: number }) =>
      api.put<Account>(`/accounts/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

/** Per-HELOC cash-sweep summary, with swept/drawn scoped to [from, to]. */
export function useHelocSummary(from?: string, to?: string, enabled = true) {
  const sp = new URLSearchParams();
  if (from) sp.set('from', from);
  if (to) sp.set('to', to);
  const qs = sp.toString();
  return useQuery<HelocSummary[]>({
    queryKey: ['accounts', 'heloc-summary', from, to],
    queryFn: () => api.get<HelocSummary[]>(`/accounts/heloc-summary${qs ? `?${qs}` : ''}`),
    enabled,
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
