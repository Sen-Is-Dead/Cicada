import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, Wifi } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * PWA lifecycle toasts (Rec 4):
 *
 * 1. "Update available" — shown when a new service worker is waiting.
 *    Tapping it calls updateServiceWorker(true) which skips waiting and
 *    reloads the page so the user gets the latest build immediately.
 *
 * 2. "Ready to work offline" — shown once after the SW is first installed
 *    and the app shell is fully cached. Dismissed automatically after 4s.
 *    A localStorage flag prevents it from re-appearing on subsequent visits.
 */

const OFFLINE_TOAST_KEY = 'cicada_offline_ready_shown';

type Toast = 'update' | 'offline' | null;

export function PWAToast() {
  const [toast, setToast] = useState<Toast>(null);

  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setToast('update');
    },
    onOfflineReady() {
      // Only show once ever — after the first SW install
      if (!localStorage.getItem(OFFLINE_TOAST_KEY)) {
        localStorage.setItem(OFFLINE_TOAST_KEY, '1');
        setToast('offline');
      }
    },
  });

  // Auto-dismiss the offline-ready toast after 4 seconds
  useEffect(() => {
    if (toast !== 'offline') return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      className={cn(
        'fixed bottom-safe-bottom left-1/2 z-50 mb-4 flex -translate-x-1/2 items-center gap-3',
        'rounded-xl border border-edge bg-surface px-4 py-3 shadow-xl',
        'animate-in fade-in slide-in-from-bottom-2 duration-300',
      )}
      role="status"
      aria-live="polite"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {toast === 'update' ? (
        <>
          <RefreshCw className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="text-sm text-main">Update available</span>
          <button
            onClick={() => void updateServiceWorker(true)}
            className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:bg-accent-hov"
          >
            Refresh
          </button>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="text-xs text-faint hover:text-muted"
          >
            Later
          </button>
        </>
      ) : (
        <>
          <Wifi className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="text-sm text-main">Ready to work offline</span>
        </>
      )}
    </div>
  );
}
