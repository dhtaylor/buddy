import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportRecord, ImportedTransaction, LedgerEntry } from '@buddy/shared';
import { api } from './client.js';

/** A staged transaction with its suggested matching ledger entry (if any). */
export interface StagedTransaction extends ImportedTransaction {
  matchedEntry: LedgerEntry | null;
}

/** Result of GET /imports/:id and POST /imports/:id/confirm. */
export interface ImportDetail {
  import: ImportRecord;
  transactions: StagedTransaction[];
}

/** Result of POST /imports (upload). */
export interface UploadResult extends ImportDetail {
  /** Count of rows skipped as duplicates. */
  skipped: number;
}

export type ConfirmDecision = {
  importedTxnId: number;
  action: 'clear' | 'add' | 'ignore';
  categoryId?: number | null;
};

/**
 * Upload a CSV/OFX file for an account as multipart/form-data.
 * The shared `api` client only sends JSON, so this hook posts the FormData
 * directly (still credentialed and unwrapping the { data } / { error } envelope).
 */
export function useUploadImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, file }: { accountId: number; file: File }) => {
      const form = new FormData();
      // accountId field must come before the file so req.file() sees it in .fields.
      form.append('accountId', String(accountId));
      form.append('file', file, file.name);
      const res = await fetch('/api/imports', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = json?.error;
        throw new Error(err?.message ?? res.statusText);
      }
      return json.data as UploadResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['imports'] }),
  });
}

export function useImports() {
  return useQuery<ImportRecord[]>({
    queryKey: ['imports'],
    queryFn: () => api.get<ImportRecord[]>('/imports'),
  });
}

export function useImport(id: number | null) {
  return useQuery<ImportDetail>({
    queryKey: ['imports', id],
    queryFn: () => api.get<ImportDetail>(`/imports/${id}`),
    enabled: id !== null,
  });
}

/** Discard an unconfirmed draft import (Cancel). Nothing was written to the ledger. */
export function useDeleteImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/imports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['imports'] }),
  });
}

export function useConfirmImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisions }: { id: number; decisions: ConfirmDecision[] }) =>
      api.post<ImportDetail>(`/imports/${id}/confirm`, { decisions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['ledger', 'balance'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
}
