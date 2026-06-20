import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export interface SystemInfo {
  households: number;
  users: number;
  admins: number;
}
export interface SystemHousehold {
  id: number;
  name: string;
  memberCount: number;
}
export interface SystemUser {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
  households: { householdId: number; householdName: string; role: 'owner' | 'member' }[];
}
export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

function invalidateSystem(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['system'] });
  qc.invalidateQueries({ queryKey: ['households'] }); // switcher
  qc.invalidateQueries({ queryKey: ['household'] });
}

export const useSystemInfo = () =>
  useQuery<SystemInfo>({ queryKey: ['system', 'info'], queryFn: () => api.get('/system/info') });

export const useSystemHouseholds = () =>
  useQuery<SystemHousehold[]>({
    queryKey: ['system', 'households'],
    queryFn: () => api.get('/system/households'),
  });

export const useSystemUsers = () =>
  useQuery<SystemUser[]>({ queryKey: ['system', 'users'], queryFn: () => api.get('/system/users') });

export const useBackups = () =>
  useQuery<BackupFile[]>({ queryKey: ['system', 'backups'], queryFn: () => api.get('/system/backups') });

export function useCreateSystemHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<SystemHousehold>('/system/households', { name }),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useRenameHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.put(`/system/households/${id}`, { name }),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useDeleteHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/system/households/${id}`),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      displayName: string;
      householdId: number;
      role: 'owner' | 'member';
    }) => api.post('/system/users', input),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useSetUserAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isAdmin }: { id: number; isAdmin: boolean }) =>
      api.put(`/system/users/${id}/admin`, { isAdmin }),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/system/users/${id}`),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useUpsertMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: number; householdId: number; role: 'owner' | 'member' }) =>
      api.put('/system/memberships', input),
    onSuccess: () => invalidateSystem(qc),
  });
}
export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ file: string }>('/system/backup'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system', 'backups'] }),
  });
}
