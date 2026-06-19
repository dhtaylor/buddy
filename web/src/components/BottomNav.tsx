import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/ledger', label: 'Ledger', icon: '📒' },
  { to: '/budget', label: 'Budget', icon: '📊' },
  { to: '/bills', label: 'Bills', icon: '🧾' },
  { to: '/import', label: 'Import', icon: '📥' },
  { to: '/history', label: 'History', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-10 grid grid-cols-7 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] min-h-[56px] ${
              isActive ? 'text-brand font-semibold' : 'text-gray-500'
            }`
          }
        >
          <span className="text-lg leading-none">{it.icon}</span>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
