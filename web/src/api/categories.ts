import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category } from '@buddy/shared';
import { api } from './client.js';

type CategoryInput = {
  groupName: string;
  name: string;
  kind: Category['kind'];
  sortOrder?: number;
};

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  });
}

function invalidateCategoryConsumers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['categories'] });
  qc.invalidateQueries({ queryKey: ['budget'] });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) => api.post<Category>('/categories', input),
    onSuccess: () => invalidateCategoryConsumers(qc),
  });
}

export function useSetCategoryArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.put<Category>(`/categories/${id}/archived`, { archived }),
    onSuccess: () => invalidateCategoryConsumers(qc),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CategoryInput & { id: number }) =>
      api.put<Category>(`/categories/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/categories/${id}`),
    onSuccess: () => invalidateCategoryConsumers(qc),
  });
}
