import { useMemo, useRef, useState } from 'react';
import { formatCents, type Category } from '@buddy/shared';
import { useAccounts } from '../api/accounts.js';
import { useCategories } from '../api/categories.js';
import {
  useUploadImport,
  useConfirmImport,
  useDeleteImport,
  type ConfirmDecision,
  type ImportDetail,
  type StagedTransaction,
  type UploadResult,
} from '../api/imports.js';

export default function Import() {
  const [result, setResult] = useState<UploadResult | null>(null);

  if (!result) {
    return <UploadStep onUploaded={setResult} />;
  }
  return <ReviewStep detail={result} skipped={result.skipped} onDone={() => setResult(null)} />;
}

/* ------------------------------- Step 1 ------------------------------- */

function UploadStep({ onUploaded }: { onUploaded: (r: UploadResult) => void }) {
  const { data: accounts } = useAccounts();
  const upload = useUploadImport();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = accountId !== '' && file !== null && !upload.isPending;

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Import transactions</h1>
        <p className="mt-1 text-sm text-gray-600">
          Download a CSV or OFX file from your bank, then upload it here. We&apos;ll match each
          transaction to entries you&apos;ve already written down and clear them for you.
        </p>
      </div>

      <form
        className="card flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          if (accountId === '' || !file) return;
          upload.mutate(
            { accountId, file },
            {
              onSuccess: (r) => onUploaded(r),
              onError: (e2) => setErr(e2 instanceof Error ? e2.message : 'Upload failed'),
            },
          );
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Which account is this statement for?
          <select
            className="select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value === '' ? '' : Number(e.target.value))}
            required
          >
            <option value="">Select an account…</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Bank file (.csv or .ofx)
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.ofx,.qfx,text/csv"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button className="btn-primary" disabled={!canSubmit}>
          {upload.isPending ? 'Uploading…' : 'Upload & match'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------- Step 2 ------------------------------- */

function ReviewStep({
  detail,
  skipped,
  onDone,
}: {
  detail: ImportDetail;
  skipped: number;
  onDone: () => void;
}) {
  const { data: categories } = useCategories();
  const confirm = useConfirmImport();
  const discard = useDeleteImport();

  const matched = detail.transactions.filter((t) => t.status === 'matched' && t.matchedEntry);
  const unmatched = detail.transactions.filter((t) => !(t.status === 'matched' && t.matchedEntry));

  // Per-transaction user choices for the unmatched section.
  const [actions, setActions] = useState<Record<number, 'add' | 'ignore'>>(() =>
    Object.fromEntries(unmatched.map((t) => [t.id, 'add'])),
  );
  const [cats, setCats] = useState<Record<number, number | ''>>({});
  const [done, setDone] = useState(false);

  const decisions = useMemo<ConfirmDecision[]>(() => {
    const list: ConfirmDecision[] = matched.map((t) => ({
      importedTxnId: t.id,
      action: 'clear',
    }));
    for (const t of unmatched) {
      const action = actions[t.id] ?? 'add';
      if (action === 'add') {
        const c = cats[t.id];
        list.push({ importedTxnId: t.id, action: 'add', categoryId: c === '' ? null : c });
      } else {
        list.push({ importedTxnId: t.id, action: 'ignore' });
      }
    }
    return list;
  }, [matched, unmatched, actions, cats]);

  if (done) {
    const added = decisions.filter((d) => d.action === 'add').length;
    const cleared = decisions.filter((d) => d.action === 'clear').length;
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Import complete</h1>
        <div className="card flex flex-col gap-1 text-sm">
          <span>{cleared} matched entr{cleared === 1 ? 'y' : 'ies'} cleared.</span>
          <span>{added} new entr{added === 1 ? 'y' : 'ies'} added to your ledger.</span>
        </div>
        <button className="btn-primary" onClick={onDone}>
          Import another file
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Review import</h1>
        <p className="mt-1 text-sm text-gray-600">
          {matched.length} matched · {unmatched.length} new
          {skipped > 0 && ` · ${skipped} skipped (already imported)`}
        </p>
      </div>

      {detail.transactions.length === 0 && (
        <div className="card text-sm text-gray-600">
          Nothing to review — every transaction in this file was already imported.
        </div>
      )}

      {matched.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Matched — these will be cleared</h2>
          <ul className="flex flex-col gap-2">
            {matched.map((t) => (
              <li key={t.id} className="card flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{t.description || '(no description)'}</div>
                  <div className="text-xs text-gray-500">
                    {t.txnDate} → clears “{t.matchedEntry!.payee}” ({t.matchedEntry!.entryDate})
                  </div>
                </div>
                <div className={amountClass(t.amountCents)}>{formatCents(t.amountCents)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unmatched.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">New / unmatched</h2>
          <p className="text-xs text-gray-500">
            No existing entry matched these. Add them to your ledger (pick a category) or ignore.
          </p>
          <ul className="flex flex-col gap-2">
            {unmatched.map((t) => (
              <UnmatchedRow
                key={t.id}
                txn={t}
                categories={categories ?? []}
                action={actions[t.id] ?? 'add'}
                categoryId={cats[t.id] ?? ''}
                onAction={(a) => setActions((s) => ({ ...s, [t.id]: a }))}
                onCategory={(c) => setCats((s) => ({ ...s, [t.id]: c }))}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-2 flex flex-col gap-2">
        {confirm.isError && (
          <p className="text-sm text-red-600">
            {confirm.error instanceof Error ? confirm.error.message : 'Failed to confirm'}
          </p>
        )}
        <button
          className="btn-primary"
          disabled={confirm.isPending || decisions.length === 0}
          onClick={() =>
            confirm.mutate(
              { id: detail.import.id, decisions },
              { onSuccess: () => setDone(true) },
            )
          }
        >
          {confirm.isPending ? 'Confirming…' : 'Confirm import'}
        </button>
        <button
          className="btn-secondary"
          onClick={() => discard.mutate(detail.import.id, { onSettled: onDone })}
          disabled={confirm.isPending || discard.isPending}
        >
          {discard.isPending ? 'Discarding…' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

function UnmatchedRow({
  txn,
  categories,
  action,
  categoryId,
  onAction,
  onCategory,
}: {
  txn: StagedTransaction;
  categories: Category[];
  action: 'add' | 'ignore';
  categoryId: number | '';
  onAction: (a: 'add' | 'ignore') => void;
  onCategory: (c: number | '') => void;
}) {
  return (
    <li className="card flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{txn.description || '(no description)'}</div>
          <div className="text-xs text-gray-500">{txn.txnDate}</div>
        </div>
        <div className={amountClass(txn.amountCents)}>{formatCents(txn.amountCents)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select py-1.5"
          value={action}
          onChange={(e) => onAction(e.target.value as 'add' | 'ignore')}
        >
          <option value="add">Add to ledger</option>
          <option value="ignore">Ignore</option>
        </select>
        {action === 'add' && (
          <select
            className="select py-1.5"
            value={categoryId}
            onChange={(e) => onCategory(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.groupName} · {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}

function amountClass(cents: number): string {
  return cents < 0 ? 'font-semibold text-red-600' : 'font-semibold text-green-700';
}
