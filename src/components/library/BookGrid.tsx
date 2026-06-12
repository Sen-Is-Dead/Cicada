import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Library } from 'lucide-react';
import { db, type Novel } from '../../db/db';
import { BookCard } from './BookCard';
import { EditBookModal } from './EditBookModal';

export function BookGrid() {
  const novels = useLiveQuery(() => db.novels.orderBy('addedAt').reverse().toArray());
  const [editing, setEditing] = useState<Novel | null>(null);

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

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {novels.map((novel) => (
          <BookCard key={novel.id} novel={novel} onEdit={setEditing} />
        ))}
      </div>
      {editing && <EditBookModal novel={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
