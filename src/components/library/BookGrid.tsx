import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Library } from 'lucide-react';
import { db, type Novel } from '../../db/db';
import { BookCard } from './BookCard';
import { EditBookModal } from './EditBookModal';
import { cn } from '../../lib/utils';

export function BookGrid() {
  // Most-recently-read first: join lastReadAt from the progress table; books
  // never opened fall back to their import date.
  const novels = useLiveQuery(async () => {
    const [list, progress] = await Promise.all([db.novels.toArray(), db.progress.toArray()]);
    const lastRead = new Map(progress.map((p) => [p.novelId, p.lastReadAt]));
    return list.sort(
      (a, b) => (lastRead.get(b.id) ?? b.addedAt) - (lastRead.get(a.id) ?? a.addedAt),
    );
  });
  const [editing, setEditing] = useState<Novel | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  // Collections are derived from the books themselves (assigned via Edit book)
  const collections = useMemo(() => {
    const set = new Set<string>();
    for (const n of novels ?? []) for (const c of n.collections ?? []) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [novels]);

  if (!novels) return null; // first IndexedDB read in flight

  if (novels.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Library className="h-10 w-10 text-faint" aria-hidden="true" />
        <p className="text-sm text-faint">
          Your library is empty.
          <br />
          Import an .epub or .txt to get started.
        </p>
      </div>
    );
  }

  // Deleting the last book of a collection silently drops a stale filter
  const active = filter !== null && collections.includes(filter) ? filter : null;
  const shown = active ? novels.filter((n) => n.collections?.includes(active)) : novels;

  return (
    <>
      {collections.length > 0 && (
        <div
          className="no-scrollbar -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
          role="tablist"
          aria-label="Collections"
        >
          <button
            role="tab"
            aria-selected={active === null}
            onClick={() => setFilter(null)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
              active === null
                ? 'border-accent bg-accent text-on-accent'
                : 'border-edge text-muted hover:bg-surface2 hover:text-main',
            )}
          >
            All
          </button>
          {collections.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={active === c}
              onClick={() => setFilter(active === c ? null : c)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
                active === c
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-edge text-muted hover:bg-surface2 hover:text-main',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-faint">No books in "{active}" yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shown.map((novel) => (
            <BookCard key={novel.id} novel={novel} onEdit={setEditing} />
          ))}
        </div>
      )}
      {editing && <EditBookModal novel={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
