import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { db, type Chapter } from '../../db/db';
import { useReaderStore } from '../../store/readerStore';
import { useTtsStore } from '../../store/ttsStore';
import { cn } from '../../lib/utils';

const RENDER_CHUNK = 80;
/** Composite position key: chapterIndex * FACTOR + paragraphIndex. */
const POS_FACTOR = 1_000_000;

interface ReaderViewportProps {
  novelId: string;
  totalChapters: number;
  startChapter: number;
  startParagraph: number;
  infinite: boolean;
  onPositionChange: (chapterIndex: number, paragraphIndex: number, chapterLength: number) => void;
  /** Explicit navigation request (e.g. "Next chapter" button in paged mode). */
  onRequestChapter: (chapterIndex: number) => void;
}

/**
 * Multi-chapter sliding-window renderer. Paragraphs mount in chunks; with
 * infinite scroll enabled, the next chapter is fetched from Dexie and appended
 * when the current one is fully rendered, so the book reads as one continuous
 * page. Parent must key this component so it remounts on explicit navigation.
 */
export const ReaderViewport = memo(function ReaderViewport({
  novelId,
  totalChapters,
  startChapter,
  startParagraph,
  infinite,
  onPositionChange,
  onRequestChapter,
}: ReaderViewportProps) {
  const fontSize = useReaderStore((s) => s.fontSize);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const theme = useReaderStore((s) => s.theme);

  // TTS highlighter state (spec Phase 4)
  const ttsStatus = useTtsStore((s) => s.status);
  const ttsChapter = useTtsStore((s) => s.chapterIndex);
  const ttsParagraph = useTtsStore((s) => s.paragraphIndex);
  const ttsActive = ttsStatus !== 'idle';
  const ttsPosKey = ttsChapter * POS_FACTOR + ttsParagraph;

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [renderCounts, setRenderCounts] = useState<Map<number, number>>(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleRef = useRef(new Set<number>());
  const paragraphRefs = useRef(new Map<number, HTMLParagraphElement>());
  const refCallbacks = useRef(new Map<number, (el: HTMLParagraphElement | null) => void>());
  const restoredRef = useRef(false);
  const loadingNextRef = useRef(false);

  // Mirror frequently-changing values into refs for stable observer callbacks
  const chaptersRef = useRef<Chapter[]>([]);
  chaptersRef.current = chapters;
  const renderCountsRef = useRef(renderCounts);
  renderCountsRef.current = renderCounts;
  const infiniteRef = useRef(infinite);
  infiniteRef.current = infinite;
  const onChangeRef = useRef(onPositionChange);
  onChangeRef.current = onPositionChange;

  // Initial chapter load (mount-only — parent remounts this component to navigate)
  useEffect(() => {
    let cancelled = false;
    void db.chapters.get(`${novelId}_${startChapter}`).then((c) => {
      if (cancelled || !c) return;
      const clamped = Math.min(Math.max(startParagraph, 0), Math.max(c.paragraphs.length - 1, 0));
      setChapters([c]);
      setRenderCounts(new Map([[c.chapterIndex, Math.min(c.paragraphs.length, clamped + RENDER_CHUNK)]]));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appendNextChapter = useCallback(() => {
    if (loadingNextRef.current) return;
    const last = chaptersRef.current[chaptersRef.current.length - 1];
    if (!last || last.chapterIndex + 1 >= totalChapters) return;
    loadingNextRef.current = true;
    void db.chapters.get(`${novelId}_${last.chapterIndex + 1}`).then((c) => {
      loadingNextRef.current = false;
      if (!c) return;
      setChapters((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));
      setRenderCounts((prev) =>
        new Map(prev).set(c.chapterIndex, Math.min(c.paragraphs.length, RENDER_CHUNK)),
      );
    });
  }, [novelId, totalChapters]);

  /** Stable per-position ref callbacks so React doesn't churn the observer. */
  const getRefCallback = (posKey: number): ((el: HTMLParagraphElement | null) => void) => {
    let cb = refCallbacks.current.get(posKey);
    if (!cb) {
      cb = (el) => {
        const prev = paragraphRefs.current.get(posKey);
        if (prev) observerRef.current?.unobserve(prev);
        if (el) {
          paragraphRefs.current.set(posKey, el);
          observerRef.current?.observe(el);
        } else {
          paragraphRefs.current.delete(posKey);
          visibleRef.current.delete(posKey);
        }
      };
      refCallbacks.current.set(posKey, cb);
    }
    return cb;
  };

  // Track the topmost visible paragraph -> (chapter, paragraph) position
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const visible = visibleRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = Number((entry.target as HTMLElement).dataset.pos);
          if (Number.isNaN(key)) continue;
          if (entry.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        if (visible.size > 0) {
          const min = Math.min(...visible);
          const chapterIndex = Math.floor(min / POS_FACTOR);
          const paragraphIndex = min % POS_FACTOR;
          const ch = chaptersRef.current.find((c) => c.chapterIndex === chapterIndex);
          onChangeRef.current(chapterIndex, paragraphIndex, ch?.paragraphs.length ?? 1);
        }
      },
      { root, rootMargin: '0px 0px -70% 0px' }, // only the top 30% band counts
    );
    observerRef.current = obs;
    paragraphRefs.current.forEach((el) => obs.observe(el));
    return () => {
      obs.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Restore the saved scroll position once the first chapter has rendered
  useEffect(() => {
    if (restoredRef.current || chapters.length === 0) return;
    restoredRef.current = true;
    if (startParagraph > 0) {
      requestAnimationFrame(() => {
        paragraphRefs.current
          .get(startChapter * POS_FACTOR + startParagraph)
          ?.scrollIntoView({ block: 'start' });
      });
    }
  }, [chapters, startChapter, startParagraph]);

  // Follow the spoken paragraph: auto-scroll, growing the window or appending
  // the next chapter when the TTS engine moves past what's rendered
  useEffect(() => {
    if (!ttsActive) return;
    const el = paragraphRefs.current.get(ttsPosKey);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const target = chaptersRef.current.find((c) => c.chapterIndex === ttsChapter);
    if (target) {
      setRenderCounts((prev) => {
        const count = prev.get(ttsChapter) ?? 0;
        if (count > ttsParagraph) return prev;
        return new Map(prev).set(
          ttsChapter,
          Math.min(target.paragraphs.length, ttsParagraph + RENDER_CHUNK),
        );
      });
    } else {
      const lastLoaded = chaptersRef.current[chaptersRef.current.length - 1];
      if (lastLoaded && ttsChapter === lastLoaded.chapterIndex + 1) appendNextChapter();
    }
  }, [ttsActive, ttsChapter, ttsParagraph, ttsPosKey, chapters, renderCounts, appendNextChapter]);

  // Grow the window / append the next chapter when the sentinel approaches
  useEffect(() => {
    const el = sentinelRef.current;
    const root = containerRef.current;
    if (!el || !root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        const last = chaptersRef.current[chaptersRef.current.length - 1];
        if (!last) return;
        const count = renderCountsRef.current.get(last.chapterIndex) ?? 0;
        if (count < last.paragraphs.length) {
          setRenderCounts((prev) =>
            new Map(prev).set(
              last.chapterIndex,
              Math.min(last.paragraphs.length, count + RENDER_CHUNK),
            ),
          );
        } else if (infiniteRef.current) {
          appendNextChapter();
        }
      },
      { root, rootMargin: '800px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [appendNextChapter, chapters, renderCounts, infinite]);

  const last = chapters[chapters.length - 1];
  const lastCount = last ? renderCounts.get(last.chapterIndex) ?? 0 : 0;
  const lastFullyRendered = !!last && lastCount >= last.paragraphs.length;
  const hasNext = !!last && last.chapterIndex + 1 < totalChapters;
  const morePossible = !!last && (!lastFullyRendered || (infinite && hasNext));

  return (
    <div
      ref={containerRef}
      className={cn('h-full overflow-y-auto', `theme-${theme}`)}
      style={{ backgroundColor: 'var(--reader-bg)', color: 'var(--reader-fg)' }}
    >
      <div
        className="mx-auto w-full max-w-2xl px-5 pb-24 pt-16"
        style={{ fontSize: `${fontSize}px`, lineHeight }}
      >
        {chapters.map((ch) => (
          <section key={ch.id}>
            <h2
              className="mb-6 mt-12 font-semibold opacity-90 first:mt-0"
              style={{ fontSize: '1.15em' }}
            >
              {ch.title}
            </h2>
            {ch.paragraphs.slice(0, renderCounts.get(ch.chapterIndex) ?? 0).map((text, i) => {
              const posKey = ch.chapterIndex * POS_FACTOR + i;
              return (
                <p
                  key={i}
                  data-pos={posKey}
                  ref={getRefCallback(posKey)}
                  className={cn(
                    'mb-[0.9em] rounded-md transition-colors duration-300',
                    ttsActive && posKey === ttsPosKey && '-mx-2 bg-accent/15 px-2',
                  )}
                >
                  {text}
                </p>
              );
            })}
          </section>
        ))}

        {morePossible && <div ref={sentinelRef} className="h-10" aria-hidden="true" />}

        {lastFullyRendered && hasNext && !infinite && (
          <button
            onClick={(e) => {
              e.stopPropagation(); // don't toggle the chrome
              onRequestChapter(last.chapterIndex + 1);
            }}
            className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg border border-current px-5 py-2.5 text-sm opacity-60 transition-opacity hover:opacity-100"
          >
            Next chapter
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {lastFullyRendered && !hasNext && (
          <p className="mt-8 text-center text-sm opacity-50">— The End —</p>
        )}
      </div>
    </div>
  );
});
