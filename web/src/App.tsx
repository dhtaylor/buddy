import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useCurrentUser } from './api/auth.js';
import { Spinner } from './components/Skeleton.js';
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
import Profile from './pages/Profile.js';

export default function App() {
  const { data: user, isLoading } = useCurrentUser();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-screen-sm flex-col">
      <HouseholdSwitcher />
      {/* key on pathname so each navigation re-triggers the fade-in. */}
      <main key={location.pathname} className="flex-1 pb-20 animate-in">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/import" element={<Import />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <InstallPrompt />
      <IdleLogout />
    </div>
  );
}
