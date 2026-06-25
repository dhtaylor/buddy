import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@buddy/shared';
import { api, ApiClientError } from './client.js';

export function useCurrentUser() {
  return useQuery<User | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<User>('/auth/me');
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

/** Whether open registration is available (only on a fresh install). */
export function useRegistrationStatus() {
  return useQuery<{ open: boolean }>({
    queryKey: ['registration-status'],
    queryFn: () => api.get<{ open: boolean }>('/auth/registration-status'),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api.post<User>('/auth/login', vars),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      email: string;
      password: string;
      displayName: string;
      householdName?: string;
    }) => api.post<User>('/auth/register', vars),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => {
      qc.setQueryData(['me'], null);
      qc.clear();
    },
  });
}

export function useAddSpouse() {
  return useMutation({
    mutationFn: (vars: { email: string; password: string; displayName: string }) =>
      api.post<User>('/auth/add-spouse', vars),
  });
}

/** Update the logged-in user's own profile (display name). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { displayName: string }) => api.put<User>('/auth/me', vars),
    onSuccess: (user) => {
      qc.setQueryData(['me'], user);
      // The member list shows display names — refresh it.
      qc.invalidateQueries({ queryKey: ['household', 'members'] });
    },
  });
}

/** Change the logged-in user's own password. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: true }>('/auth/change-password', vars),
  });
}
