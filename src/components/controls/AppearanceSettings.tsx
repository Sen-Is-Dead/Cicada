import { useRef, useState, type ChangeEvent } from 'react';
import { X, Moon, Sun, Check, Download, Upload, Loader2 } from 'lucide-react';
import { useReaderStore, type AccentId, type UiMode } from '../../store/readerStore';
import { exportBackup, importBackup } from '../../lib/backup';
import { cn } from '../../lib/utils';

interface AppearanceSettingsProps {
  onClose: () => void;
}

const ACCENTS: { id: AccentId; label: string; hex: string }[] = [
  { id: 'emerald', label: 'Green', hex: '#10b981' },
  { id: 'red', label: 'Red', hex: '#ef4444' },
  { id: 'sky', label: 'Light blue', hex: '#38bdf8' },
  { id: 'blue', label: 'Dark blue', hex: '#2563eb' },
  { id: 'pink', label: 'Pink', hex: '#ec4899' },
  { id: 'purple', label: 'Purple', hex: '#8b5cf6' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'amber', label: 'Gold', hex: '#f59e0b' },
];

const MODES: { id: UiMode; label: string; icon: typeof Moon }[] = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
];

export function AppearanceSettings({ onClose }: AppearanceSettingsProps) {
  const uiMode = useReaderStore((s) => s.uiMode);
  const accent = useReaderStore((s) => s.accent);
  const setUiMode = useReaderStore((s) => s.setUiMode);
  const setAccent = useReaderStore((s) => s.setAccent);

  // Phase 5: manual JSON backup of the entire IndexedDB library
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const handleExport = async (): Promise<void> => {
    if (busy) return;
    setBusy('export');
    setMessage(null);
    try {
      const blob = await exportBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cicada-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Backup downloaded.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setBusy('import');
    setMessage(null);
    try {
      const result = await importBackup(file);
      setMessage(`Restored ${result.novels} book${result.novels === 1 ? '' : 's'}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Appearance settings"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-edge bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Appearance</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-surface2 hover:text-main"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-1.5 text-xs text-muted">Mode</p>
        <div className="mb-5 grid grid-cols-2 gap-1.5">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setUiMode(id)}
              aria-pressed={uiMode === id}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                uiMode === id
                  ? 'border-accent text-accent'
                  : 'border-edge text-muted hover:bg-surface2',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <p className="mb-1.5 text-xs text-muted">Accent colour</p>
        <div className="mb-5 grid grid-cols-4 gap-2">
          {ACCENTS.map(({ id, label, hex }) => (
            <button
              key={id}
              onClick={() => setAccent(id)}
              aria-pressed={accent === id}
              aria-label={`${label} accent`}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 text-[10px] transition-colors',
                accent === id ? 'border-accent text-main' : 'border-transparent text-muted hover:bg-surface2',
              )}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{ backgroundColor: hex }}
              >
                {accent === id && <Check className="h-4 w-4 text-white mix-blend-difference" />}
              </span>
              {label}
            </button>
          ))}
        </div>

        {/* Backup (spec Phase 5: manual JSON export/import) */}
        <p className="mb-1.5 border-t border-edge pt-4 text-xs text-muted">Backup</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => void handleExport()}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-muted transition-colors hover:bg-surface2 hover:text-main disabled:opacity-40"
          >
            {busy === 'export' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            Export
          </button>
          <button
            onClick={() => importRef.current?.click()}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm text-muted transition-colors hover:bg-surface2 hover:text-main disabled:opacity-40"
          >
            {busy === 'import' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            Import
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => void handleImport(e)}
          />
        </div>
        {message && <p className="mt-2 text-xs text-faint">{message}</p>}
        <p className="mt-2 text-xs text-faint">
          Exports your whole library — books, progress, notes, and fixer rules — as a JSON file.
        </p>
      </div>
    </div>
  );
}
