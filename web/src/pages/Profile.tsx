import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useChangePassword, useCurrentUser, useUpdateProfile } from '../api/auth.js';
import { ApiClientError } from '../api/client.js';

export default function Profile() {
  const location = useLocation();
  const passwordRef = useRef<HTMLDivElement>(null);

  // When arrived via the "Change password" menu item (/profile#password), bring
  // that section into view.
  useEffect(() => {
    if (location.hash === '#password') {
      passwordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold">Profile</h1>
      <NameSection />
      <div ref={passwordRef} id="password" className="scroll-mt-4">
        <PasswordSection />
      </div>
    </div>
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

function NameSection() {
  const { data: user } = useCurrentUser();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Seed the field once the user loads.
  useEffect(() => {
    if (user) setDisplayName(user.displayName);
  }, [user]);

  const unchanged = !user || displayName.trim() === user.displayName;

  return (
    <Section title="Your details">
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          setErr(null);
          try {
            await update.mutateAsync({ displayName: displayName.trim() });
            setMsg('Saved.');
          } catch (e2) {
            setErr(e2 instanceof ApiClientError ? e2.message : 'Failed to save');
          }
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Display name
          <input
            className="input"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setMsg(null);
            }}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-500">
          Email
          <input className="input bg-gray-50 text-gray-500" value={user?.email ?? ''} disabled />
        </label>
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary" disabled={unchanged || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const canSubmit =
    currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirm;

  return (
    <Section title="Change password">
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          setErr(null);
          try {
            await change.mutateAsync({ currentPassword, newPassword });
            setMsg('Password changed.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirm('');
          } catch (e2) {
            setErr(e2 instanceof ApiClientError ? e2.message : 'Failed to change password');
          }
        }}
      >
        <input
          type="password"
          className="input"
          placeholder="Current password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <input
          type="password"
          className="input"
          placeholder="New password (8+ characters)"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
        />
        <input
          type="password"
          className="input"
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {mismatch && <p className="text-sm text-red-600">Passwords don’t match.</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-primary" disabled={!canSubmit || change.isPending}>
          {change.isPending ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </Section>
  );
}
