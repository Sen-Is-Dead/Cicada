import { useEffect, useState } from 'react';

/**
 * Captures the browser's beforeinstallprompt event so we can show a custom
 * "Install app" banner rather than relying on the browser's default UI.
 *
 * Returns:
 *  - canPrompt   — true when the event has been captured and not yet fired
 *  - triggerPrompt — call this inside a user gesture to show the native prompt
 *  - dismiss     — hide the banner permanently (writes a localStorage flag)
 */

const DISMISSED_KEY = 'cicada_install_dismissed';

interface UseInstallPromptResult {
  canPrompt: boolean;
  triggerPrompt: () => void;
  dismiss: () => void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already dismissed permanently or already installed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault(); // prevent auto-prompt
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // If the app is already installed, clear any stale event
    window.addEventListener('appinstalled', () => {
      setDeferredEvent(null);
      localStorage.setItem(DISMISSED_KEY, '1');
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const triggerPrompt = (): void => {
    if (!deferredEvent) return;
    void deferredEvent.prompt();
    void deferredEvent.userChoice.then(() => {
      // Whether accepted or dismissed, clear the event — it can only be used once
      setDeferredEvent(null);
    });
  };

  const dismiss = (): void => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDeferredEvent(null);
  };

  return {
    canPrompt: deferredEvent !== null,
    triggerPrompt,
    dismiss,
  };
}
