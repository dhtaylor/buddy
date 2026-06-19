import { useState } from 'react';
import { useLogin, useRegister } from '../api/auth.js';
import { ApiClientError } from '../api/client.js';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useLogin();
  const register = useRegister();
  const pending = login.isPending || register.isPending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'login') {
        await login.mutateAsync({ email, password });
      } else {
        await register.mutateAsync({
          email,
          password,
          displayName,
          householdName: householdName || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong');
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-brand">Buddy</h1>
        <p className="text-gray-500">Family finance, your way</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {mode === 'register' && (
          <>
            <Field label="Your name">
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </Field>
            <Field label="Household name (optional)">
              <input
                className="input"
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Email">
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : undefined}
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="text-sm text-brand underline"
        onClick={() => {
          setError(null);
          setMode((m) => (m === 'login' ? 'register' : 'login'));
        }}
      >
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {label}
      {children}
    </label>
  );
}
