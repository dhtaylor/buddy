import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account } from '@buddy/shared';
import { api } from './client.js';

type AccountInput = { name: string; type: Account['type']; openingBalanceCents: number };

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

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
