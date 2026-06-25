import { NavLink } from 'react-router-dom';
import {
  Home,
  NotebookText,
  PieChart,
  ReceiptText,
  Download,
  TrendingUp,
  Settings,
  type LucideIcon,
} from 'lucide-react';

const items: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/ledger', label: 'Ledger', icon: NotebookText },
  { to: '/budget', label: 'Budget', icon: PieChart },
  { to: '/bills', label: 'Bills', icon: ReceiptText },
  { to: '/import', label: 'Import', icon: Download },
  { to: '/history', label: 'History', icon: TrendingUp },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-10 grid grid-cols-7 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-2 text-[10px] min-h-[56px] transition-colors ${
                isActive ? 'text-brand font-semibold' : 'text-gray-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-7 w-9 items-center justify-center rounded-full transition-colors ${
                    isActive ? 'bg-brand/10' : ''
                  }`}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
                </span>
                {it.label}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
