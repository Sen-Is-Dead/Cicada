import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { BookOpen, Download, Palette, Plus, X } from 'lucide-react';
import { BookGrid } from './components/library/BookGrid';
import { ImportModal } from './components/library/ImportModal';
import { BookDetailPage } from './components/library/BookDetailPage';
import { ReaderPage } from './components/reader/ReaderPage';
import { AppearanceSettings } from './components/controls/AppearanceSettings';
import { PWAToast } from './components/pwa/PWAToast';
import { useReaderStore } from './store/readerStore';
import { useInstallPrompt } from './hooks/useInstallPrompt';

function LibraryPage() {
  const [importOpen, setImportOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { canPrompt, triggerPrompt, dismiss } = useInstallPrompt();

  return (
    <main className="mx-auto flex h-full w-full max-w-5xl flex-col">
      <header
        className="flex shrink-0 items-center justify-between border-b border-edge px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <BookOpen className="h-5 w-5 text-accent" aria-hidden="true" />
          Cicada
        </h1>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAppearanceOpen(true)}
            aria-label="Appearance settings"
            className="rounded-lg p-2 text-muted transition-colors hover:bg-surface2 hover:text-main"
          >
            <Palette className="h-5 w-5" />
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hov"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Import
          </button>
        </div>
      </header>

      {/* Install banner — only shown when browser fires beforeinstallprompt */}
      {canPrompt && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <p className="text-sm text-main">
              Install Cicada for the best offline experience
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={triggerPrompt}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:bg-accent-hov"
            >
              Install
            </button>
            <button
              onClick={dismiss}
              aria-label="Dismiss install banner"
              className="p-1 text-faint hover:text-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <BookGrid />
      </div>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {appearanceOpen && <AppearanceSettings onClose={() => setAppearanceOpen(false)} />}
    </main>
  );
}

export default function App() {
  const uiMode = useReaderStore((s) => s.uiMode);
  const accent = useReaderStore((s) => s.accent);

  // Apply the app-wide theme to <html> so every route (and portal) inherits it
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('mode-light', uiMode === 'light');
    root.dataset.accent = accent;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', uiMode === 'light' ? '#fafaf9' : '#09090b');
  }, [uiMode, accent]);

  return (
    <div className="flex h-full flex-col bg-app text-main">
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/book/:novelId" element={<BookDetailPage />} />
        <Route path="/reader/:novelId" element={<ReaderPage />} />
      </Routes>
      {/* PWA lifecycle toasts — SW update available + offline ready */}
      <PWAToast />
    </div>
  );
}
