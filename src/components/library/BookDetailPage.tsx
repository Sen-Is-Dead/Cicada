import { useEffect, useRef, useState, type UIEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, BookOpen, Star, Play, Pencil, Loader2, LocateFixed, Search, StickyNote, Trash2, Download, X } from 'lucide-react';
import { db } from '../../db/db';
import { EditBookModal } from './EditBookModal';
import { exportNovelBackup } from '../../lib/backup';
import { fmtEta, countWords } from '../../hooks/useReadingStats';
import { cn } from '../../lib/utils';

const LIST_CHUNK = 150;
const SAMPLE_CHAPTERS = 8; // number of chapters to sample for avg word count

/**
 * Midpoint between library and reader: metadata, rating, description, and the
 * full chapter list. Titles come from novel.chapterTitles (denormalized at
 * import); legacy imports are backfilled once from the chapters table.
 */
export function BookDetailPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const novel = useLiveQuery(() => (novelId ? db.novels.get(novelId) : undefined), [novelId]);
  const progress = useLiveQuery(() => (novelId ? db.progress.get(novelId) : undefined), [novelId]);
  const notes = useLiveQuery(
    () =>
      novelId
        ? db.notes
            .where('novelId')
            .equals(novelId)
            .sortBy('timestamp')
            .then((list) => list.reverse())
        : [],
    [novelId],
    [],
  );

  const [titles, setTitles] = useState<string[] | null>(null);
  const [listCount, setListCount] = useState(LIST_CHUNK);
  const [editing, setEditing] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bookEtaMs, setBookEtaMs] = useState<number | null>(null);
  const backfillingRef = useRef(false);

  /* --------------- chapter search / quick jump (#6) --------------- */
  const [query, setQuery] = useState('');
  /** Chapter index we're navigating the list to (waits for the list to grow). */
  const [pendingJump, setPendingJump] = useState<number | null>(null);
  /** Briefly highlighted row after a jump. */
  const [flash, setFlash] = useState<number | null>(null);

  const jumpToChapter = (index: number): void => {
    setQuery('');
    setListCount((c) => Math.max(c, Math.ceil((index + 20) / LIST_CHUNK) * LIST_CHUNK));
    setPendingJump(index);
  };

  // Once the row exists in the DOM, scroll it into view and flash it
  useEffect(() => {
    if (pendingJump === null || titles === null) return;
    if (listCount <= pendingJump) return; // list still growing
    const el = document.getElementById(`chapter-row-${pendingJump}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setFlash(pendingJump);
    setPendingJump(null);
    const t = window.setTimeout(() => setFlash(null), 2000);
    return () => window.clearTimeout(t);
  }, [pendingJump, listCount, titles]);

  useEffect(() => {
    if (!novel?.coverImage) {
      setCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(novel.coverImage);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [novel?.coverImage]);

  // Chapter titles: use the denormalized list, or backfill it once (legacy imports)
  useEffect(() => {
    if (!novel) return;
    if (novel.chapterTitles?.length === novel.totalChapters) {
      setTitles(novel.chapterTitles);
      return;
    }
    if (backfillingRef.current) return;
    backfillingRef.current = true;
    let cancelled = false;
    void (async () => {
      const list = new Array<string>(novel.totalChapters).fill('');
      await db.chapters.where('novelId').equals(novel.id).each((c) => {
        if (c.chapterIndex < list.length) list[c.chapterIndex] = c.title;
      });
      if (cancelled) return;
      setTitles(list);
      await db.novels.update(novel.id, { chapterTitles: list });
      backfillingRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
  }, [novel]);

  // Estimate book ETA: sample a few chapters to get avg words, then extrapolate
  useEffect(() => {
    if (!novel || !progress) return;
    const wpm = progress.readingSpeedWPM;
    if (!wpm || wpm <= 0) return;
    const remaining = novel.totalChapters - progress.currentChapterIndex - 1;
    if (remaining <= 0) return;
    let cancelled = false;
    void (async () => {
      // Sample up to SAMPLE_CHAPTERS chapters spread across the whole book
      const step = Math.max(1, Math.floor(novel.totalChapters / SAMPLE_CHAPTERS));
      const indices: number[] = [];
      for (let i = 0; i < novel.totalChapters && indices.length < SAMPLE_CHAPTERS; i += step) {
        indices.push(i);
      }
      const sample = await Promise.all(
        indices.map((idx) => db.chapters.get(`${novel.id}_${idx}`)),
      );
      if (cancelled) return;
      const wordCounts = sample
        .filter(Boolean)
        .map((ch) => ch!.paragraphs.reduce((s, p) => s + countWords(p), 0));
      if (wordCounts.length === 0) return;
      const avgWords = wordCounts.reduce((s, w) => s + w, 0) / wordCounts.length;
      const estimatedWords = remaining * avgWords;
      setBookEtaMs((estimatedWords / wpm) * 60_000);
    })();
    return () => {
      cancelled = true;
    };
  }, [novel, progress]);

  const handleListScroll = (e: UIEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
      setListCount((c) => (titles && c < titles.length ? c + LIST_CHUNK : c));
    }
  };

  const setRating = (value: number): void => {
    if (!novel) return;
    void db.novels.update(novel.id, { rating: novel.rating === value ? undefined : value });
  };

  const handleExport = async (): Promise<void> => {
    if (!novelId || exporting) return;
    setExporting(true);
    try {
      const blob = await exportNovelBackup(novelId);
      const safeTitle = (novel?.title ?? 'book').replace(/[^a-z0-9]/gi, '_').slice(0, 50);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cicada_${safeTitle}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (!novelId) return null;
  if (!novel) {
    return (
      <main className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-faint" aria-hidden="true" />
      </main>
    );
  }

  const hasProgress =
    !!progress && (progress.currentChapterIndex > 0 || progress.currentParagraphIndex > 0);
  const currentChapter = progress?.currentChapterIndex ?? 0;

  /* Derived search results for the chapter list */
  const q = query.trim();
  const numericQuery = /^\d+$/.test(q)
    ? Math.min(Math.max(Number(q), 1), novel.totalChapters)
    : null;
  const filtering = q.length > 0;
  let chapterRows: number[] = [];
  if (titles !== null) {
    if (numericQuery !== null) {
      // A number shows the neighbourhood around that chapter ("look around there")
      const center = numericQuery - 1;
      const from = Math.max(0, center - 3);
      const to = Math.min(titles.length, center + 21);
      for (let i = from; i < to; i++) chapterRows.push(i);
    } else if (filtering) {
      const needle = q.toLowerCase();
      for (let i = 0; i < titles.length && chapterRows.length < 300; i++) {
        const label = titles[i] || `Chapter ${i + 1}`;
        if (label.toLowerCase().includes(needle)) chapterRows.push(i);
      }
    } else {
      chapterRows = Array.from({ length: Math.min(listCount, titles.length) }, (_, i) => i);
    }
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header
        className="flex shrink-0 items-center justify-between border-b border-edge px-2 pb-2"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      >
        <Link
          to="/"
          aria-label="Back to library"
          className="flex items-center gap-1 rounded-md p-1.5 text-sm text-muted hover:bg-surface2 hover:text-main"
        >
          <ChevronLeft className="h-5 w-5" />
          Library
        </Link>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => void handleExport()}
            disabled={exporting}
            aria-label="Export this book"
            title="Export this book"
            className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main disabled:opacity-40"
          >
            {exporting
              ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              : <Download className="h-5 w-5" aria-hidden="true" />
            }
          </button>
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit book"
            className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main"
          >
            <Pencil className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" onScroll={handleListScroll}>
        {/* Book header */}
        <div className="flex gap-4 px-4 pt-5">
          <div className="flex w-28 shrink-0 items-center justify-center self-start overflow-hidden rounded-lg border border-edge bg-surface2 sm:w-36">
            <div className="flex aspect-[2/3] w-full items-center justify-center">
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
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-snug sm:text-xl">{novel.title}</h1>
            <p className="mt-0.5 truncate text-sm text-muted">{novel.author}</p>
            <p className="mt-1 text-xs text-faint">
              {novel.totalChapters} chapters · added {new Date(novel.addedAt).toLocaleDateString()}
            </p>
            <div className="mt-2 flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => setRating(v)}
                  aria-label={`Rate ${v} of 5`}
                  className="p-0.5"
                >
                  <Star
                    className={cn(
                      'h-5 w-5 transition-colors',
                      (novel.rating ?? 0) >= v
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-faint hover:text-faint',
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="px-4 pt-4 text-sm leading-relaxed text-muted">
          {novel.description || 'No description. Add one with the edit button.'}
        </p>

        {/* Start / Continue */}
        <div className="px-4 pb-2 pt-4">
          <Link
            to={`/reader/${novel.id}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hov"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {hasProgress ? `Continue — Chapter ${currentChapter + 1}` : 'Start reading'}
          </Link>
          {hasProgress && bookEtaMs != null && bookEtaMs > 0 && (
            <p className="mt-1.5 text-center text-xs text-faint">
              {fmtEta(bookEtaMs)} remaining in book
            </p>
          )}
        </div>

        {/* Notes (saved via long-press in the reader) */}
        {notes.length > 0 && (
          <>
            <h2 className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-faint">
              <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
              Notes ({notes.length})
            </h2>
            <ul>
              {notes.map((note) => (
                <li key={note.id} className="flex items-start gap-2 border-b border-edge/60 px-4 py-2.5">
                  <Link
                    to={`/reader/${novel.id}?chapter=${note.chapterIndex}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="line-clamp-2 text-sm italic leading-snug text-muted">
                      "{note.selectedText || note.text}"
                    </p>
                    {note.text && note.selectedText && (
                      <p className="mt-0.5 text-sm leading-snug text-main">{note.text}</p>
                    )}
                    <p className="mt-0.5 text-xs text-faint">
                      Chapter {note.chapterIndex + 1} ·{' '}
                      {new Date(note.timestamp).toLocaleDateString()}
                    </p>
                  </Link>
                  <button
                    onClick={() => void db.notes.delete(note.id)}
                    aria-label="Delete note"
                    className="shrink-0 rounded p-1 text-muted hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Chapter list */}
        <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-faint">Chapters</h2>
          {hasProgress && titles !== null && (
            <button
              onClick={() => jumpToChapter(currentChapter)}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-accent hover:bg-surface2"
            >
              <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
              Current — Ch. {currentChapter + 1}
            </button>
          )}
        </div>
        {/* Search: text filters by title; a number (e.g. 100) shows the
            chapters around it — Enter jumps straight to it in the full list */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && numericQuery !== null) jumpToChapter(numericQuery - 1);
              }}
              placeholder="Search chapters — title, or a number like 100"
              aria-label="Search chapters"
              className="w-full rounded-lg border border-edge bg-surface py-1.5 pl-8 pr-8 text-sm text-main outline-none placeholder:text-faint focus:border-accent"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear chapter search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-faint hover:text-main"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {numericQuery !== null && (
          <div className="px-4 pb-1">
            <button
              onClick={() => jumpToChapter(numericQuery - 1)}
              className="w-full rounded-lg border border-accent/40 px-3 py-1.5 text-center text-xs text-accent hover:bg-surface2"
            >
              Go to chapter {numericQuery} in the full list
            </button>
          </div>
        )}
        {titles === null ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-faint">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading chapter list…
          </div>
        ) : (
          <ul className="pb-8">
            {chapterRows.map((i) => (
              <li key={i} id={`chapter-row-${i}`}>
                <Link
                  to={`/reader/${novel.id}?chapter=${i}`}
                  className={cn(
                    'flex items-baseline gap-3 border-b border-edge/60 px-4 py-2.5 text-sm transition-colors hover:bg-surface',
                    flash === i && 'bg-accent/15',
                    hasProgress && i === currentChapter
                      ? 'text-accent'
                      : 'text-muted',
                  )}
                >
                  <span className="w-10 shrink-0 text-right text-xs text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{titles[i] || `Chapter ${i + 1}`}</span>
                </Link>
              </li>
            ))}
            {filtering && chapterRows.length === 0 && (
              <li className="px-4 py-4 text-center text-xs text-faint">
                No chapters match "{query.trim()}".
              </li>
            )}
            {!filtering && listCount < titles.length && (
              <li className="px-4 py-3 text-center text-xs text-faint">
                Scroll for more ({titles.length - listCount} remaining)
              </li>
            )}
          </ul>
        )}
      </div>

      {editing && <EditBookModal novel={novel} onClose={() => setEditing(false)} />}
    </main>
  );
}
