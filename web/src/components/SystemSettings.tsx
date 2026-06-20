import { useState } from 'react';
import { useHousehold } from '../api/household.js';
import {
  useBackups,
  useCreateSystemHousehold,
  useCreateUser,
  useDeleteHousehold,
  useDeleteUser,
  useRenameHousehold,
  useRunBackup,
  useSetUserAdmin,
  useSystemHouseholds,
  useSystemInfo,
  useSystemUsers,
  useUpsertMembership,
  type SystemHousehold,
  type SystemUser,
} from '../api/system.js';

// System Settings — visible only to the global (system) admin. Manages all
// households, users/admins, and backups across the whole install.
export default function SystemSettings() {
  return (
    <section className="flex flex-col gap-4 rounded-xl border-2 border-teal-200 bg-teal-50/40 p-3">
      <h2 className="text-lg font-bold text-teal-800">System Settings (admin)</h2>
      <Overview />
      <Households />
      <Users />
      <Backups />
    </section>
  );
}

function Overview() {
  const { data } = useSystemInfo();
  if (!data) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Stat label="Households" value={data.households} />
      <Stat label="Users" value={data.users} />
      <Stat label="Admins" value={data.admins} />
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Households() {
  const { data: households } = useSystemHouseholds();
  const active = useHousehold();
  const create = useCreateSystemHousehold();
  const [name, setName] = useState('');

  return (
    <div className="card flex flex-col gap-2">
      <h3 className="font-semibold">Households</h3>
      <ul className="flex flex-col gap-1">
        {households?.map((h) => (
          <HouseholdRow key={h.id} hh={h} isActive={h.id === active.data?.id} />
        ))}
      </ul>
      <form
        className="flex gap-2 border-t border-gray-100 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName('') });
        }}
      >
        <input
          className="input"
          placeholder="New household name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-primary shrink-0" disabled={create.isPending || !name.trim()}>
          Create
        </button>
      </form>
    </div>
  );
}

function HouseholdRow({ hh, isActive }: { hh: SystemHousehold; isActive: boolean }) {
  const rename = useRenameHousehold();
  const del = useDeleteHousehold();
  const [name, setName] = useState(hh.name);

  return (
    <li className="flex items-center gap-2 rounded bg-gray-50 px-2 py-1.5">
      <input
        className="input flex-1 py-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== hh.name && rename.mutate({ id: hh.id, name: name.trim() })}
      />
      <span className="shrink-0 text-xs text-gray-500">{hh.memberCount} member(s)</span>
      <button
        className="btn-danger shrink-0 py-1"
        disabled={isActive || del.isPending}
        title={isActive ? 'Switch away before deleting' : 'Delete household and all its data'}
        onClick={() => {
          if (
            window.confirm(`Delete "${hh.name}" and ALL its accounts, transactions, and budgets? This cannot be undone.`)
          ) {
            del.mutate(hh.id);
          }
        }}
      >
        Delete
      </button>
    </li>
  );
}

function Users() {
  const { data: users } = useSystemUsers();
  const { data: households } = useSystemHouseholds();
  return (
    <div className="card flex flex-col gap-2">
      <h3 className="font-semibold">Users &amp; admins</h3>
      <ul className="flex flex-col gap-2">
        {users?.map((u) => (
          <UserRow key={u.id} u={u} households={households ?? []} />
        ))}
      </ul>
      <CreateUserForm households={households ?? []} />
    </div>
  );
}

function UserRow({ u, households }: { u: SystemUser; households: SystemHousehold[] }) {
  const setAdmin = useSetUserAdmin();
  const del = useDeleteUser();
  const upsert = useUpsertMembership();
  const [addHh, setAddHh] = useState('');

  const memberHhIds = new Set(u.households.map((h) => h.householdId));
  const addable = households.filter((h) => !memberHhIds.has(h.id));

  return (
    <li className="flex flex-col gap-1.5 rounded bg-gray-50 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">
            {u.displayName}
            {u.isAdmin && (
              <span className="ml-2 rounded bg-teal-100 px-1.5 text-xs text-teal-700">system admin</span>
            )}
          </div>
          <div className="truncate text-xs text-gray-500">{u.email}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className="btn-secondary py-1"
            onClick={() => setAdmin.mutate({ id: u.id, isAdmin: !u.isAdmin })}
          >
            {u.isAdmin ? 'Revoke admin' : 'Make admin'}
          </button>
          <button
            className="btn-danger py-1"
            onClick={() => window.confirm(`Delete user ${u.email}?`) && del.mutate(u.id)}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Memberships + role (owner = household admin) */}
      <ul className="flex flex-col gap-1 pl-2">
        {u.households.map((h) => (
          <li key={h.householdId} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">{h.householdName}</span>
            <select
              className="select w-32 py-1"
              value={h.role}
              onChange={(e) =>
                upsert.mutate({
                  userId: u.id,
                  householdId: h.householdId,
                  role: e.target.value as 'owner' | 'member',
                })
              }
            >
              <option value="member">Member</option>
              <option value="owner">Household admin</option>
            </select>
          </li>
        ))}
      </ul>

      {addable.length > 0 && (
        <div className="flex items-center gap-2 pl-2">
          <select
            className="select flex-1 py-1"
            value={addHh}
            onChange={(e) => setAddHh(e.target.value)}
          >
            <option value="">Add to household…</option>
            {addable.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary py-1"
            disabled={!addHh}
            onClick={() => {
              upsert.mutate(
                { userId: u.id, householdId: Number(addHh), role: 'member' },
                { onSuccess: () => setAddHh('') },
              );
            }}
          >
            Add
          </button>
        </div>
      )}
    </li>
  );
}

function CreateUserForm({ households }: { households: SystemHousehold[] }) {
  const create = useCreateUser();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = email && displayName && password.length >= 8 && householdId;

  return (
    <form
      className="flex flex-col gap-2 border-t border-gray-100 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (!canSubmit) return;
        create.mutate(
          { email, displayName, password, householdId: Number(householdId), role },
          {
            onSuccess: () => {
              setEmail('');
              setDisplayName('');
              setPassword('');
              setHouseholdId('');
              setRole('member');
            },
            onError: (e2) => setErr(e2 instanceof Error ? e2.message : 'Failed to create user'),
          },
        );
      }}
    >
      <div className="text-sm font-medium text-gray-700">Add user</div>
      <input className="input" placeholder="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" type="password" placeholder="Temporary password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="flex gap-2">
        <select className="select flex-1" value={householdId} onChange={(e) => setHouseholdId(e.target.value)}>
          <option value="">Household…</option>
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <select className="select w-36" value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'member')}>
          <option value="member">Member</option>
          <option value="owner">Household admin</option>
        </select>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn-primary" disabled={!canSubmit || create.isPending}>
        Add user
      </button>
    </form>
  );
}

function Backups() {
  const { data: backups } = useBackups();
  const run = useRunBackup();
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Backups</h3>
        <button className="btn-secondary py-1" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      {backups && backups.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-gray-600">
          {backups.slice(0, 8).map((b) => (
            <li key={b.name} className="flex justify-between tabular-nums">
              <span className="truncate">{b.name}</span>
              <span className="shrink-0 pl-2">{(b.sizeBytes / 1024).toFixed(0)} KB</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400">No backups yet.</p>
      )}
    </div>
  );
}
