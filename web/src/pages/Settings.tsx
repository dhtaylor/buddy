import { useMemo, useState } from 'react';
import { formatCents, parseCents, type Account, type Category, type Household } from '@buddy/shared';
import { useLogout } from '../api/auth.js';
import {
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from '../api/accounts.js';
import {
  useCategories,
  useCreateCategory,
  useSetCategoryArchived,
} from '../api/categories.js';
import {
  useHousehold,
  useHouseholdMembers,
  useMyHouseholds,
  useRemoveMember,
  useUpdateHousehold,
} from '../api/household.js';
import { useAddSpouse, useCurrentUser } from '../api/auth.js';
import { ApiClientError } from '../api/client.js';
import SystemSettings from '../components/SystemSettings.js';

export default function Settings() {
  const logout = useLogout();
  const { data: user } = useCurrentUser();
  const active = useHousehold();
  const mine = useMyHouseholds();
  const myRole = mine.data?.find((h) => h.household.id === active.data?.id)?.role;
  const isHouseholdAdmin = myRole === 'owner';
  const isSystemAdmin = !!user?.isAdmin;

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button className="btn-secondary" onClick={() => logout.mutate()}>
          Log out
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-base font-bold uppercase tracking-wide text-gray-500">
          Household Settings
        </h2>
        {isHouseholdAdmin ? (
          <>
            <HouseholdSection />
            <AccountsSection />
            <CategoriesSection />
            <SpouseSection />
          </>
        ) : (
          <ReadOnlyHousehold />
        )}
      </div>

      {isSystemAdmin && <SystemSettings />}
    </div>
  );
}

// Read-only view for non-admin members.
function ReadOnlyHousehold() {
  const { data: household } = useHousehold();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const members = useHouseholdMembers();

  return (
    <Section title="Household">
      <p className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Only the household admin can change these settings.
      </p>
      {household && (
        <div className="text-sm">
          <div className="font-medium">{household.name}</div>
          <div className="text-gray-500">Budget period: {household.periodLength}</div>
        </div>
      )}
      <div className="text-sm">
        <div className="font-medium">Accounts</div>
        <ul className="mt-1 list-disc pl-5 text-gray-600">
          {accounts?.map((a) => (
            <li key={a.id}>
              {a.name} — {formatCents(a.openingBalanceCents)} opening
            </li>
          ))}
          {accounts?.length === 0 && <li className="list-none text-gray-400">None</li>}
        </ul>
      </div>
      <div className="text-sm">
        <div className="font-medium">Categories</div>
        <div className="mt-1 text-gray-600">
          {(categories ?? []).filter((c) => !c.archived).length} active
        </div>
      </div>
      <div className="text-sm">
        <div className="font-medium">Members</div>
        <ul className="mt-1 list-disc pl-5 text-gray-600">
          {members.data?.map((m) => (
            <li key={m.user.id}>
              {m.user.displayName} — {m.member.role === 'owner' ? 'household admin' : 'member'}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

// --- Household + period config ---
function HouseholdSection() {
  const { data } = useHousehold();
  const update = useUpdateHousehold();
  const members = useHouseholdMembers();
  const { data: me } = useCurrentUser();
  const removeMember = useRemoveMember();

  if (!data) return <Section title="Household">Loading…</Section>;
  return (
    <Section title="Household">
      <HouseholdForm household={data} onSave={(patch) => update.mutate(patch)} />
      <div className="text-sm text-gray-600">
        <div className="font-medium">Members</div>
        <ul className="mt-1 flex flex-col gap-1">
          {members.data?.map((m) => (
            <li
              key={m.user.id}
              className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5"
            >
              <span>
                {m.user.displayName} ({m.user.email}) —{' '}
                {m.member.role === 'owner' ? 'household admin' : 'member'}
              </span>
              {m.user.id !== me?.id && (
                <button
                  className="btn-danger py-1"
                  onClick={() =>
                    window.confirm(`Remove ${m.user.displayName} from this household?`) &&
                    removeMember.mutate(m.user.id)
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function HouseholdForm({
  household,
  onSave,
}: {
  household: Household;
  onSave: (patch: Partial<Household>) => void;
}) {
  const [name, setName] = useState(household.name);
  const [periodLength, setPeriodLength] = useState(household.periodLength);
  const [anchor, setAnchor] = useState(household.periodAnchorDate);
  const [customDays, setCustomDays] = useState(household.periodCustomDays ?? 7);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name,
          periodLength,
          periodAnchorDate: anchor,
          periodCustomDays: periodLength === 'custom' ? customDays : null,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Household name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Budget period
        <select
          className="select"
          value={periodLength}
          onChange={(e) => setPeriodLength(e.target.value as Household['periodLength'])}
        >
          <option value="weekly">Weekly (Sun–Sat)</option>
          <option value="biweekly">Biweekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom days</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Period anchor date
        <input
          type="date"
          className="input"
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
        />
      </label>
      {periodLength === 'custom' && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Days per period
          <input
            type="number"
            min={1}
            className="input"
            value={customDays}
            onChange={(e) => setCustomDays(Number(e.target.value))}
          />
        </label>
      )}
      <button className="btn-primary">Save household</button>
    </form>
  );
}

// --- Accounts + opening balances ---
function AccountsSection() {
  const { data: accounts } = useAccounts();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const del = useDeleteAccount();

  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('checking');
  const [opening, setOpening] = useState('');

  return (
    <Section title="Accounts & opening balances">
      <ul className="flex flex-col gap-2">
        {accounts?.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            onSave={(patch) => update.mutate({ id: a.id, ...patch })}
            onDelete={() => del.mutate(a.id)}
          />
        ))}
      </ul>

      <form
        className="flex flex-col gap-2 border-t border-gray-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const cents = parseCents(opening) ?? 0;
          create.mutate(
            { name, type, openingBalanceCents: cents },
            {
              onSuccess: () => {
                setName('');
                setOpening('');
                setType('checking');
              },
            },
          );
        }}
      >
        <div className="text-sm font-medium text-gray-700">Add account</div>
        <input
          className="input"
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select
          className="select"
          value={type}
          onChange={(e) => setType(e.target.value as Account['type'])}
        >
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="cash">Cash</option>
        </select>
        <input
          className="input"
          placeholder="Opening balance (e.g. 1,000.00)"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
        />
        <button className="btn-primary">Add account</button>
      </form>
    </Section>
  );
}

function AccountRow({
  account,
  onSave,
  onDelete,
}: {
  account: Account;
  onSave: (patch: { name: string; type: Account['type']; openingBalanceCents: number }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [type, setType] = useState(account.type);
  const [opening, setOpening] = useState(formatCents(account.openingBalanceCents).replace('$', ''));

  if (!editing) {
    return (
      <li className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
        <div>
          <div className="font-medium">{account.name}</div>
          <div className="text-xs text-gray-500">
            {account.type} · opening {formatCents(account.openingBalanceCents)}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary py-1.5" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg bg-gray-50 px-3 py-2">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      <select
        className="select"
        value={type}
        onChange={(e) => setType(e.target.value as Account['type'])}
      >
        <option value="checking">Checking</option>
        <option value="savings">Savings</option>
        <option value="cash">Cash</option>
      </select>
      <input className="input" value={opening} onChange={(e) => setOpening(e.target.value)} />
      <div className="flex gap-2">
        <button
          className="btn-primary py-1.5"
          onClick={() => {
            onSave({ name, type, openingBalanceCents: parseCents(opening) ?? 0 });
            setEditing(false);
          }}
        >
          Save
        </button>
        <button className="btn-secondary py-1.5" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </li>
  );
}

// --- Categories ---
function CategoriesSection() {
  const { data: categories } = useCategories();
  const create = useCreateCategory();
  const setArchived = useSetCategoryArchived();

  const [groupName, setGroupName] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Category['kind']>('expense');

  const activeGroups = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories ?? []) {
      if (c.archived) continue;
      if (!map.has(c.groupName)) map.set(c.groupName, []);
      map.get(c.groupName)!.push(c);
    }
    return [...map.entries()];
  }, [categories]);

  const hidden = useMemo(() => (categories ?? []).filter((c) => c.archived), [categories]);

  return (
    <Section title="Categories">
      <div className="flex flex-col gap-3">
        {activeGroups.map(([group, cats]) => (
          <div key={group}>
            <div className="text-sm font-semibold text-gray-700">{group}</div>
            <ul className="mt-1 flex flex-col gap-1">
              {cats.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5 text-sm"
                >
                  <span>
                    {c.name}
                    {c.kind === 'income' && (
                      <span className="ml-2 rounded bg-green-100 px-1.5 text-xs text-green-700">
                        income
                      </span>
                    )}
                  </span>
                  <button
                    className="btn-secondary py-1"
                    onClick={() => setArchived.mutate({ id: c.id, archived: true })}
                  >
                    Hide
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <div className="text-sm font-semibold text-gray-500">Hidden</div>
          <p className="mb-1 text-xs text-gray-400">
            Off the Budget page; past transactions &amp; History are kept.
          </p>
          <ul className="flex flex-col gap-1">
            {hidden.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded bg-gray-50 px-3 py-1.5 text-sm text-gray-500"
              >
                <span>
                  {c.groupName} · {c.name}
                </span>
                <button
                  className="btn-secondary py-1"
                  onClick={() => setArchived.mutate({ id: c.id, archived: false })}
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="flex flex-col gap-2 border-t border-gray-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { groupName, name, kind },
            { onSuccess: () => { setName(''); } },
          );
        }}
      >
        <div className="text-sm font-medium text-gray-700">Add category</div>
        <input
          className="input"
          placeholder="Group (e.g. Utilities)"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="Category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value as Category['kind'])}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <button className="btn-primary">Add category</button>
      </form>
    </Section>
  );
}

// --- Add spouse ---
function SpouseSection() {
  const addSpouse = useAddSpouse();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Section title="Add spouse / partner">
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          setErr(null);
          try {
            await addSpouse.mutateAsync({ email, displayName, password });
            setMsg(`Added ${displayName}. They can log in now.`);
            setEmail('');
            setDisplayName('');
            setPassword('');
          } catch (e2) {
            setErr(e2 instanceof ApiClientError ? e2.message : 'Failed to add');
          }
        }}
      >
        <input
          className="input"
          placeholder="Their name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <input
          type="email"
          className="input"
          placeholder="Their email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          className="input"
          placeholder="Temporary password (8+ chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary">Add to household</button>
      </form>
    </Section>
  );
}
