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
