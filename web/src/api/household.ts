import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Household, HouseholdMember, User } from '@buddy/shared';
import { api } from './client.js';

export function useHousehold() {
  return useQuery<Household>({
    queryKey: ['household'],
    queryFn: () => api.get<Household>('/household'),
  });
}

export type HouseholdUpdate = Partial<{
  name: string;
  periodLength: Household['periodLength'];
  periodAnchorDate: string;
  periodCustomDays: number | null;
  helocStrategyEnabled: boolean;
}>;

export function useUpdateHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HouseholdUpdate) => api.put<Household>('/household', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household'] }),
  });
}

export function useHouseholdMembers() {
  return useQuery<Array<{ member: HouseholdMember; user: User }>>({
    queryKey: ['household', 'members'],
    queryFn: () => api.get<Array<{ member: HouseholdMember; user: User }>>('/household/members'),
  });
}

/** Remove a member from the active household (household admin only). */
export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => api.del<{ ok: true }>(`/household/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household', 'members'] }),
  });
}

export interface MyHousehold {
  household: Household;
  role: HouseholdMember['role'];
}

/** Every household the logged-in user belongs to (for the switcher). */
export function useMyHouseholds() {
  return useQuery<MyHousehold[]>({
    queryKey: ['households', 'mine'],
    queryFn: () => api.get<MyHousehold[]>('/household/mine'),
  });
}

/** Switch the active household. */
export function useSwitchHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (householdId: number) =>
      api.post<Household>('/household/switch', { householdId }),
    onSuccess: () => qc.clear(),
  });
}
