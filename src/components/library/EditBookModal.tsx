import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { X, BookOpen, ImagePlus, Trash2 } from 'lucide-react';
import { db, type Novel } from '../../db/db';

interface EditBookModalProps {
  novel: Novel;
  onClose: () => void;
}

export function EditBookModal({ novel, onClose }: EditBookModalProps) {
  const [title, setTitle] = useState(novel.title);
  const [author, setAuthor] = useState(novel.author);
  const [description, setDescription] = useState(novel.description ?? '');
  const [cover, setCover] = useState<Blob | undefined>(novel.coverImage);
  const [saving, setSaving] = useState(false);
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
