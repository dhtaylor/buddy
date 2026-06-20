import { useEffect, useRef } from 'react';
import { useLogout } from '../api/auth.js';

// Auto-logout after a period of inactivity. Logging out clears the in-memory
// data cache and returns to the login screen, so an unattended device doesn't
// leave financial data on screen or cached. Configure with VITE_IDLE_MINUTES
// (build-time); defaults to 15 minutes.
const IDLE_MINUTES = Math.max(1, Number(import.meta.env.VITE_IDLE_MINUTES ?? 15));
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel'];

export default function IdleLogout() {
  const logout = useLogout();
  // Keep a ref so the effect can run once without re-subscribing each render.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const ms = IDLE_MINUTES * 60_000;
    let timer: number | undefined;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!logoutRef.current.isPending) logoutRef.current.mutate();
      }, ms);
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  return null;
}
