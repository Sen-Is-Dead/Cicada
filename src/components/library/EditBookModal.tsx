import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, BookOpen, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { db, type Novel } from '../../db/db';
import { cn } from '../../lib/utils';

interface EditBookModalProps {
  novel: Novel;
  onClose: () => void;
}

export function EditBookModal({ novel, onClose }: EditBookModalProps) {
  const [title, setTitle] = useState(novel.title);
  const [author, setAuthor] = useState(novel.author);
  const [description, setDescription] = useState(novel.description ?? '');
  const [cover, setCover] = useState<Blob | undefined>(novel.coverImage);
  const [collections, setCollections] = useState<string[]>(novel.collections ?? []);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Labels already used anywhere in the library → one-tap suggestions
  const allNovels = useLiveQuery(() => db.novels.toArray(), [], [] as Novel[]);
  const knownLabels = useMemo(() => {
    const set = new Set<string>();
    for (const n of allNovels) for (const c of n.collections ?? []) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allNovels]);

  const toggleLabel = (label: string): void => {
    setCollections((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const addLabel = (): void => {
    const label = newLabel.trim();
    if (!label) return;
    if (!collections.includes(label)) setCollections((prev) => [...prev, label]);
    setNewLabel('');
  };
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cover) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(cover);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const handlePickCover = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) setCover(file);
    e.target.value = '';
  };

  const handleSave = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    // Dexie deletes keys explicitly set to undefined — removes the cover cleanly
    await db.novels.update(novel.id, {
      title: trimmed,
      author: author.trim() || 'Unknown author',
      coverImage: cover,
      description: description.trim() || undefined,
      collections: collections.length > 0 ? collections : undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${novel.title}`}
    >
      <div className="w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit book</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-surface2 hover:text-main"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-4">
          {/* Cover */}
          <div className="flex w-28 shrink-0 flex-col gap-2">
            <div className="flex aspect-[2/3] items-center justify-center overflow-hidden rounded-md border border-edge bg-surface2">
              {previewUrl ? (
                <img src={previewUrl} alt="Cover preview" className="h-full w-full object-cover" />
              ) : (
                <BookOpen className="h-8 w-8 text-faint" aria-hidden="true" />
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-muted hover:bg-surface2"
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Replace
            </button>
            {cover && (
              <button
                onClick={() => setCover(undefined)}
                className="flex items-center justify-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-muted hover:bg-surface2 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePickCover}
            />
          </div>

          {/* Fields */}
          <div className="flex flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-md border border-edge bg-app px-2.5 py-1.5 text-sm text-main outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Author
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="rounded-md border border-edge bg-app px-2.5 py-1.5 text-sm text-main outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="flex-1 resize-none rounded-md border border-edge bg-app px-2.5 py-1.5 text-sm text-main outline-none focus:border-accent"
              />
            </label>
          </div>
        </div>

        {/* Collections — custom labels used to group books in the library */}
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-muted">Collections</p>
          {knownLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knownLabels.map((label) => (
                <button
                  key={label}
                  onClick={() => toggleLabel(label)}
                  aria-pressed={collections.includes(label)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    collections.includes(label)
                      ? 'border-accent bg-accent text-on-accent'
                      : 'border-edge text-muted hover:bg-surface2 hover:text-main',
                  )}
                >
                  {label}
                </button>
              ))}
              {/* Brand-new labels (not saved anywhere yet) appear alongside */}
              {collections
                .filter((l) => !knownLabels.includes(l))
                .map((label) => (
                  <button
                    key={label}
                    onClick={() => toggleLabel(label)}
                    aria-pressed
                    className="rounded-full border border-accent bg-accent px-2.5 py-1 text-xs text-on-accent"
                  >
                    {label}
                  </button>
                ))}
            </div>
          )}
          {knownLabels.length === 0 && collections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {collections.map((label) => (
                <button
                  key={label}
                  onClick={() => toggleLabel(label)}
                  aria-pressed
                  className="rounded-full border border-accent bg-accent px-2.5 py-1 text-xs text-on-accent"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLabel();
                }
              }}
              placeholder='New collection, e.g. "To read"'
              aria-label="New collection name"
              className="w-full min-w-0 rounded-md border border-edge bg-app px-2.5 py-1.5 text-sm text-main outline-none focus:border-accent"
            />
            <button
              onClick={addLabel}
              disabled={!newLabel.trim()}
              aria-label="Add collection"
              className="shrink-0 rounded-md border border-edge p-1.5 text-muted hover:bg-surface2 hover:text-main disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-edge px-4 py-1.5 text-sm hover:bg-surface2"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!title.trim() || saving}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hov disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
