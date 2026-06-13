import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Plus, Trash2, Globe, Book } from 'lucide-react';
import { db } from '../../db/db';
import { cn, uuid } from '../../lib/utils';

interface DictionaryModalProps {
  novelId: string;
  onClose: () => void;
}

/**
 * Phase 5: Translation Fixer rule manager. Rules live in db.dictionary and are
 * applied to every string before it reaches SpeechSynthesisUtterance (spec §5).
 * Scope is either this book (novelId) or 'global' (all books).
 */
export function DictionaryModal({ novelId, onClose }: DictionaryModalProps) {
  const rules = useLiveQuery(
    () => db.dictionary.where('novelId').anyOf(novelId, 'global').toArray(),
    [novelId],
    [],
  );

  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<'book' | 'global'>('book');
  const [error, setError] = useState<string | null>(null);

  const addRule = async (): Promise<void> => {
    const p = pattern.trim();
    if (!p) return;
    try {
      new RegExp(p, 'g');
    } catch {
      setError('Invalid regular expression');
      return;
    }
    setError(null);
    await db.dictionary.put({
      id: uuid(),
      novelId: scope === 'global' ? 'global' : novelId,
      regex: p,
      replacement,
      isActive: true,
    });
    setPattern('');
    setReplacement('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Translation fixer"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-edge bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">Translation fixer</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-surface2 hover:text-main"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-xs text-faint">
          Regex replacements applied to the read-aloud audio. e.g.{' '}
          <code className="rounded bg-surface2 px-1">\bGu worm\b</code> → "Goo worm"
        </p>

        {/* Rule list */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rules.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">No rules yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center gap-2 rounded-lg border border-edge px-2.5 py-2"
                >
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    onChange={(e) =>
                      void db.dictionary.update(rule.id, { isActive: e.target.checked })
                    }
                    aria-label="Rule active"
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  <div className={cn('min-w-0 flex-1 text-xs', !rule.isActive && 'opacity-40')}>
                    <p className="truncate font-mono text-main">{rule.regex}</p>
                    <p className="truncate text-muted">→ {rule.replacement || '(remove)'}</p>
                  </div>
                  {rule.novelId === 'global' ? (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="All books" />
                  ) : (
                    <Book className="h-3.5 w-3.5 shrink-0 text-faint" aria-label="This book" />
                  )}
                  <button
                    onClick={() => void db.dictionary.delete(rule.id)}
                    aria-label="Delete rule"
                    className="shrink-0 rounded p-1 text-muted hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add form */}
        <div className="mt-3 flex flex-col gap-2 border-t border-edge pt-3">
          <div className="flex gap-2">
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="Pattern (regex)"
              className="min-w-0 flex-1 rounded-md border border-edge bg-app px-2.5 py-1.5 font-mono text-xs text-main outline-none focus:border-accent"
            />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replacement"
              className="min-w-0 flex-1 rounded-md border border-edge bg-app px-2.5 py-1.5 text-xs text-main outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'book' | 'global')}
              aria-label="Rule scope"
              className="rounded-md border border-edge bg-app px-2 py-1.5 text-xs text-main outline-none focus:border-accent"
            >
              <option value="book">This book</option>
              <option value="global">All books</option>
            </select>
            <button
              onClick={() => void addRule()}
              disabled={!pattern.trim()}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hov disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add rule
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
