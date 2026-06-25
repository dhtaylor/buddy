import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, KeyRound, LogOut } from 'lucide-react';
import { useCurrentUser, useLogout } from '../api/auth.js';

/** Initials from a display name: first letters of up to two words, uppercased. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return letters.toUpperCase();
}

// Avatar button in the top bar that opens a small menu for managing your profile
// and logging out. Closes on outside click or Escape.
export default function ProfileMenu() {
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profile menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white transition-[transform,box-shadow] hover:shadow-md active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
      >
        {initialsOf(user.displayName)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 w-60 origin-top-right overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg animate-in"
        >
          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
              {initialsOf(user.displayName)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-800">{user.displayName}</div>
              <div className="truncate text-xs text-gray-500">{user.email}</div>
            </div>
          </div>

          <MenuItem icon={Pencil} label="Edit profile" onClick={() => go('/profile')} />
          <MenuItem
            icon={KeyRound}
            label="Change password"
            onClick={() => go('/profile#password')}
          />

          <div className="border-t border-gray-100">
            <MenuItem
              icon={LogOut}
              label="Log out"
              danger
              onClick={() => {
                setOpen(false);
                logout.mutate();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50 ${
        danger ? 'text-red-600' : 'text-gray-700'
      }`}
    >
      <Icon size={16} aria-hidden="true" />
      {label}
    </button>
  );
}
