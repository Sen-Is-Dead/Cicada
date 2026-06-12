import { Moon, Sun, Coffee, type LucideIcon } from 'lucide-react';
import { useReaderStore, type ReaderTheme } from '../../store/readerStore';
import { cn } from '../../lib/utils';

const THEMES: { id: ReaderTheme; label: string; icon: LucideIcon }[] = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'sepia', label: 'Sepia', icon: Coffee },
];

export function ThemeToggle() {
  const theme = useReaderStore((s) => s.theme);
  const setTheme = useReaderStore((s) => s.setTheme);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted">Theme</p>
      <div className="grid grid-cols-3 gap-1.5">
        {THEMES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTheme(id)}
            aria-pressed={theme === id}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs transition-colors',
              theme === id
                ? 'border-accent text-accent'
                : 'border-edge text-muted hover:bg-surface2',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
