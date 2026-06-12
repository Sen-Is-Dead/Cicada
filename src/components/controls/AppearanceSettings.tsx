import { X, Moon, Sun, Check } from 'lucide-react';
import { useReaderStore, type AccentId, type UiMode } from '../../store/readerStore';
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
        <div className="grid grid-cols-4 gap-2">
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
      </div>
    </div>
  );
}
