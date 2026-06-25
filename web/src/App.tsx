import { Navigate, Route, Routes } from 'react-router-dom';
import { useCurrentUser } from './api/auth.js';
import BottomNav from './components/BottomNav.js';
import HouseholdSwitcher from './components/HouseholdSwitcher.js';
import IdleLogout from './components/IdleLogout.js';
import InstallPrompt from './components/InstallPrompt.js';
import Login from './pages/Login.js';
import Home from './pages/Home.js';
import Ledger from './pages/Ledger.js';
import Budget from './pages/Budget.js';
import Bills from './pages/Bills.js';
import Import from './pages/Import.js';
import History from './pages/History.js';
import Settings from './pages/Settings.js';
import Guide from './pages/Guide.js';

export default function App() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-gray-400">Loading…</div>;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-screen-sm flex-col">
      <HouseholdSwitcher />
      <main className="flex-1 pb-20">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/import" element={<Import />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <InstallPrompt />
      <IdleLogout />
    </div>
  );
}
