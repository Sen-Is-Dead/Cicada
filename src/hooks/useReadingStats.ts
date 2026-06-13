import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db/db';

/**
 * Measures actual reading speed from paragraph dwell times and computes
 * a chapter-level ETA. WPM is kept alive in the caller's wpmRef so the
 * existing db.progress.put effects persist it without extra writes here.
 *
 * Algorithm:
 *  - When paragraphIndex advances, record elapsed ms for the paragraph that
 *    was just left. Dwell outside [MIN, MAX] is treated as idle/skip and
 *    discarded. Valid measurements update wpmRef via EWMA.
 *  - ETA = remaining words (current paragraph+1 → end of chapter) / wpm.
 */

const MIN_DWELL_MS = 4_000;    // < 4 s → skipped, not read
const MAX_DWELL_MS = 300_000;  // > 5 min → user was idle
const EWMA_ALPHA = 0.25;       // weight of each new measurement
const WORD_RE = /\S+/g;

function countWords(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

export interface UseReadingStatsResult {
  /** ms remaining in the current chapter at current WPM (null = not enough data). */
  chapterEtaMs: number | null;
}

export function useReadingStats(
  novelId: string | undefined,
  chapterIndex: number,
  paragraphIndex: number,
  wpmRef: React.MutableRefObject<number>,
): UseReadingStatsResult {
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const entryTimeRef = useRef<number>(Date.now());
  const prevParaRef = useRef<number>(paragraphIndex);
  const prevChapterRef = useRef<number>(chapterIndex);

  // Load chapter paragraphs whenever the chapter changes
  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    // Reset timing state so we don't measure across chapter boundaries
    entryTimeRef.current = Date.now();
    prevParaRef.current = paragraphIndex;
    void db.chapters.get(`${novelId}_${chapterIndex}`).then((ch) => {
      if (cancelled) return;
      setParagraphs(ch?.paragraphs ?? []);
    });
    return () => {
      cancelled = true;
    };
    // paragraphIndex intentionally omitted — only re-load on chapter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, chapterIndex]);

  // Measure paragraph dwell time and update WPM via EWMA
  useEffect(() => {
    const now = Date.now();
    const prev = prevParaRef.current;
    const prevChapter = prevChapterRef.current;

    // Only count forward movement within the same chapter
    if (paragraphIndex > prev && chapterIndex === prevChapter && paragraphs.length > 0) {
      const elapsed = now - entryTimeRef.current;
      if (elapsed >= MIN_DWELL_MS && elapsed <= MAX_DWELL_MS) {
        const words = countWords(paragraphs[prev] ?? '');
        if (words > 0) {
          const instantWPM = words / (elapsed / 60_000);
          // Clamp to a sane human reading range
          const clamped = Math.max(50, Math.min(1500, instantWPM));
          wpmRef.current = Math.round(
            wpmRef.current * (1 - EWMA_ALPHA) + clamped * EWMA_ALPHA,
          );
        }
      }
    }

    prevParaRef.current = paragraphIndex;
    prevChapterRef.current = chapterIndex;
    entryTimeRef.current = now;
  }, [paragraphIndex, chapterIndex, paragraphs, wpmRef]);

  // Compute chapter ETA: remaining words from next paragraph to end
  const chapterEtaMs = useMemo<number | null>(() => {
    if (paragraphs.length === 0 || wpmRef.current <= 0) return null;
    const remaining = paragraphs.slice(paragraphIndex + 1);
    if (remaining.length === 0) return null;
    const words = remaining.reduce((sum, p) => sum + countWords(p), 0);
    return words > 0 ? (words / wpmRef.current) * 60_000 : null;
  }, [paragraphs, paragraphIndex, wpmRef]);

  return { chapterEtaMs };
}

/** Format a millisecond duration as a short human-readable string. */
export function fmtEta(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return '< 1m';
  if (totalMin < 60) return `~${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
}

/** Count words across all paragraphs of a chapter. */
export { countWords };
