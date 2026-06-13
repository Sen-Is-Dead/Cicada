import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, UploadCloud, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useEpub, type ImportTarget } from '../../hooks/useEpub';
import { db } from '../../db/db';
import { cn } from '../../lib/utils';

interface ImportModalProps {
  onClose: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  opening: 'Unpacking file…',
  parsing: 'Parsing chapters…',
  storing: 'Saving to library…',
};

export function ImportModal({ onClose }: ImportModalProps) {
  const { status, importFiles, reset } = useEpub();
  const novels = useLiveQuery(() => db.novels.orderBy('addedAt').reverse().toArray(), [], []);
  const [targetId, setTargetId] = useState<string>('new');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy =
    status.phase === 'opening' || status.phase === 'parsing' || status.phase === 'storing';
  const pct =
    status.totalChapters > 0
      ? Math.round((status.processedChapters / status.totalChapters) * 100)
      : null;

  const handleFiles = (list: FileList | null | undefined): void => {
    const files = list ? [...list] : [];
    if (files.length === 0 || busy) return;
    const target: ImportTarget =
      targetId === 'new' ? { mode: 'new' } : { mode: 'append', novelId: targetId };
    void importFiles(files, target);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>): void => {
    handleFiles(e.target.files);
    e.target.value = ''; // allow re-selecting the same files
  };

  const close = (): void => {
    if (busy) return; // don't abandon a half-finished import
    reset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import novel"
    >
      <div className="w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Import</h2>
          <button
            onClick={close}
            disabled={busy}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-surface2 hover:text-main disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {status.phase === 'idle' && (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Add to
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="rounded-md border border-edge bg-app px-2.5 py-2 text-sm text-main outline-none focus:border-accent"
              >
                <option value="new">New book</option>
                {novels.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title} ({n.totalChapters} ch.)
                  </option>
                ))}
              </select>
            </label>

            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
                dragOver
                  ? 'border-accent bg-accent/10'
                  : 'border-edge hover:border-faint',
              )}
            >
              <UploadCloud className="h-9 w-9 text-muted" aria-hidden="true" />
              <p className="text-sm text-muted">
                Drop <span className="font-medium text-main">.epub</span> or{' '}
                <span className="font-medium text-main">.txt</span> files here,
                <br />
                or tap to browse
              </p>
              <p className="text-xs text-faint">
                Multiple files are merged into one book, in filename order.
              </p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".epub,.txt,application/epub+zip,text/plain"
                className="hidden"
                onChange={handleInput}
              />
            </div>
          </div>
        )}

        {busy && (
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              <span className="truncate">{status.label}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface2">
              <div
                className={cn(
                  'h-full rounded-full bg-accent transition-[width]',
                  pct === null && 'w-1/4 animate-pulse',
                )}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </div>
            <p className="text-xs text-faint">
              {status.totalFiles > 1 && `File ${status.fileIndex}/${status.totalFiles} — `}
              {PHASE_LABEL[status.phase]}
              {pct !== null && ` ${status.processedChapters}/${status.totalChapters}`}
            </p>
          </div>
        )}

        {status.phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-9 w-9 text-accent" aria-hidden="true" />
            <p className="text-sm text-muted">
              Added {status.addedChapters} chapter{status.addedChapters === 1 ? '' : 's'} to{' '}
              <span className="font-medium text-main">{status.label}</span>
              {status.bookTotalChapters !== status.addedChapters &&
                ` — ${status.bookTotalChapters} total`}
            </p>
            {status.skippedSections > 0 && (
              <p className="text-xs text-amber-400">
                {status.skippedSections} section{status.skippedSections === 1 ? '' : 's'} could not
                be parsed and {status.skippedSections === 1 ? 'was' : 'were'} skipped.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="rounded-lg border border-edge px-4 py-1.5 text-sm hover:bg-surface2"
              >
                Import more
              </button>
              <button
                onClick={close}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hov"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {status.phase === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertTriangle className="h-9 w-9 text-red-400" aria-hidden="true" />
                       <p className="text-sm text-red-300">{status.error}</p>
            <button
              onClick={reset}
              className="rounded-lg border border-edge px-4 py-1.5 text-sm hover:bg-surface2"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
