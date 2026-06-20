import { useEffect, useState } from 'react';

// Lightweight "Add to Home Screen" banner. Chrome/Edge/Android fire
// `beforeinstallprompt`; we stash it and offer a one-tap install. (iOS Safari
// doesn't fire it — there she uses Share → Add to Home Screen, per the README.)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('buddy.install.dismissed') === '1');

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!deferred || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem('buddy.install.dismissed', '1');
  };

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 mx-auto flex max-w-screen-sm items-center gap-3 px-4">
      <div className="card flex w-full items-center justify-between gap-3 shadow-lg">
        <span className="text-sm font-medium">Install Buddy on this device?</span>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={dismiss}>Not now</button>
          <button
            className="btn-primary"
            onClick={async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setDeferred(null);
            }}
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
