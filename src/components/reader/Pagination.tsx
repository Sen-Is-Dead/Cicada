import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtEta } from '../../hooks/useReadingStats';

interface PaginationProps {
  chapterIndex: number;
  totalChapters: number;
  /** 0–1 fraction read within the current chapter (smooths the bar). */
  chapterFraction: number;
  /** Remaining time in the current chapter (ms). Null/undefined = not yet measured. */
  chapterEtaMs?: number | null;
  onNavigate: (index: number) => void;
}

/**
 * Bottom chrome: read-only overall progress bar plus prev/next chapter
 * buttons. Chapter jumping happens from the book detail page.
 */
export function Pagination({
  chapterIndex,
  totalChapters,
  chapterFraction,
  chapterEtaMs,
  onNavigate,
}: PaginationProps) {
  const max = Math.max(0, totalChapters - 1);
  const overall =
    totalChapters > 0 ? Math.min(1, (chapterIndex + Math.min(chapterFraction, 1)) / totalChapters) : 0;

  return (
    <footer
      className="border-t border-edge bg-app/90 px-4 pt-2 backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <div className="flex items-center gap-3">
        <button
          disabled={chapterIndex <= 0}
          onClick={() => onNavigate(chapterIndex - 1)}
          aria-label="Previous chapter"
          className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overall * 100)}
            aria-label="Book progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${overall * 100}%` }}
            />
          </div>
          <p className="text-center text-xs text-faint">
            Chapter {Math.min(chapterIndex, max) + 1} / {Math.max(totalChapters, 1)} ·{' '}
            {Math.round(overall * 100)}%
            {chapterEtaMs != null && chapterEtaMs > 0 && (
              <span className="ml-1.5">· {fmtEta(chapterEtaMs)} left</span>
            )}
          </p>
        </div>

        <button
          disabled={chapterIndex >= max}
          onClick={() => onNavigate(chapterIndex + 1)}
          aria-label="Next chapter"
          className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </footer>
  );
}
