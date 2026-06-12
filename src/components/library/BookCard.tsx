import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Pencil, Trash2 } from 'lucide-react';
import { db, type Novel } from '../../db/db';

interface BookCardProps {
  novel: Novel;
  onEdit: (novel: Novel) => void;
}

export function BookCard({ novel, onEdit }: BookCardProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!novel.coverImage) {
      setCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(novel.coverImage);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [novel.coverImage]);

  const stop = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDelete = async (e: MouseEvent): Promise<void> => {
    stop(e);
    if (!window.confirm(`Delete "${novel.title}" and all its data?`)) return;
    await db.transaction('rw', db.novels, db.chapters, db.progress, db.notes, async () => {
      await db.chapters.where('novelId').equals(novel.id).delete();
      await db.notes.where('novelId').equals(novel.id).delete();
      await db.progress.delete(novel.id);
      await db.novels.delete(novel.id);
    });
  };

  return (
    <Link
      to={`/book/${novel.id}`}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-edge bg-surface transition-colors hover:border-faint"
    >
      <div className="flex aspect-[2/3] items-center justify-center overflow-hidden bg-surface2">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${novel.title}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <BookOpen className="h-10 w-10 text-faint" aria-hidden="true" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{novel.title}</p>
        <p className="truncate text-xs text-faint">{novel.author}</p>
        <p className="mt-auto pt-1 text-xs text-faint">{novel.totalChapters} chapters</p>
      </div>

      <div className="absolute right-1.5 top-1.5 flex flex-col gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={(e) => {
            stop(e);
            onEdit(novel);
          }}
          aria-label={`Edit ${novel.title}`}
          className="rounded-md bg-app/70 p-1.5 text-muted hover:text-accent"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={(e) => void handleDelete(e)}
          aria-label={`Delete ${novel.title}`}
          className="rounded-md bg-app/70 p-1.5 text-muted hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </Link>
  );
}
