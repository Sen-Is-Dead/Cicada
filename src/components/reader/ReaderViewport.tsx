import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AudioLines, ChevronRight } from 'lucide-react';
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
  /** Double-tap on a paragraph: start TTS from there. */
  onSpeakFrom: (chapterIndex: number, paragraphIndex: number) => void;
}

/**
 * Multi-chapter sliding-window renderer. Paragraphs mount in chunks; with
 * infinite scroll, the next chapter is appended when the current one is fully
 * rendered, and chapters more than one behind the reading position are
 * unloaded with manual scrollTop compensation (native scroll anchoring is
 * disabled), so the page never jumps and memory stays bounded.
 */
export const ReaderViewport = memo(function ReaderViewport({
  novelId,
  totalChapters,
  startChapter,
  startParagraph,
  infinite,
  onPositionChange,
  onRequestChapter,
  onSpeakFrom,
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
  /** Visual detachment: user scrolled away while audio plays. */
  const [detached, setDetached] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleRef = useRef(new Set<number>());
  const paragraphRefs = useRef(new Map<number, HTMLParagraphElement>());
  const refCallbacks = useRef(new Map<number, (el: HTMLParagraphElement | null) => void>());
  const sectionRefs = useRef(new Map<number, HTMLElement>());
  const restoredRef = useRef(false);
  const loadingNextRef = useRef(false);
  const pruneAdjustRef = useRef(0);

  // Mirror frequently-changing values into refs for stable observer callbacks
  const chaptersRef = useRef<Chapter[]>([]);
  chaptersRef.current = chapters;
  const renderCountsRef = useRef(renderCounts);
  renderCountsRef.current = renderCounts;
  const infiniteRef = useRef(infinite);
  infiniteRef.current = infinite;
  const onChangeRef = useRef(onPositionChange);
  onChangeRef.current = onPositionChange;
  const ttsActiveRef = useRef(ttsActive);
  ttsActiveRef.current = ttsActive;

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

  /**
   * Unload chapters that are 2+ behind the active reading position. The
   * removed section's height is subtracted from scrollTop in a layout effect,
   * so the visible text doesn't move a pixel.
   */
  const pruneIfNeeded = useCallback((activeChapter: number) => {
    const list = chaptersRef.current;
    const first = list[0];
    if (!first || list.length < 3) return;
    if (activeChapter - first.chapterIndex < 2) return;
    const el = sectionRefs.current.get(first.chapterIndex);
    pruneAdjustRef.current += el?.offsetHeight ?? 0;
    setChapters((prev) => prev.slice(1));
    setRenderCounts((prev) => {
      const m = new Map(prev);
      m.delete(first.chapterIndex);
      return m;
    });
  }, []);

  useLayoutEffect(() => {
    if (pruneAdjustRef.current !== 0 && containerRef.current) {
      containerRef.current.scrollTop -= pruneAdjustRef.current;
      pruneAdjustRef.current = 0;
    }
  }, [chapters]);

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
          // While listening, the audio owns the reading position
          if (!ttsActiveRef.current) {
            const ch = chaptersRef.current.find((c) => c.chapterIndex === chapterIndex);
            onChangeRef.current(chapterIndex, paragraphIndex, ch?.paragraphs.length ?? 1);
          }
          pruneIfNeeded(chapterIndex);
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
  }, [pruneIfNeeded]);

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

  // Visual detachment: any manual scroll input while listening pauses auto-centering
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const detach = (): void => {
      if (ttsActiveRef.current) setDetached(true);
    };
    root.addEventListener('wheel', detach, { passive: true });
    root.addEventListener('touchmove', detach, { passive: true });
    return () => {
      root.removeEventListener('wheel', detach);
      root.removeEventListener('touchmove', detach);
    };
  }, []);

  useEffect(() => {
    if (!ttsActive) setDetached(false);
  }, [ttsActive]);

  // Follow the spoken paragraph: sync position/progress, auto-center (unless
  // detached), growing the window or appending the next chapter as needed
  useEffect(() => {
    if (!ttsActive) return;
    const spokenChapter = chaptersRef.current.find((c) => c.chapterIndex === ttsChapter);
    onChangeRef.current(ttsChapter, ttsParagraph, spokenChapter?.paragraphs.length ?? 1);
    pruneIfNeeded(ttsChapter);
    if (detached) return; // user is looking ahead — don't rip them back
    const el = paragraphRefs.current.get(ttsPosKey);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (spokenChapter) {
      setRenderCounts((prev) => {
        const count = prev.get(ttsChapter) ?? 0;
        if (count > ttsParagraph) return prev;
        return new Map(prev).set(
          ttsChapter,
          Math.min(spokenChapter.paragraphs.length, ttsParagraph + RENDER_CHUNK),
        );
      });
    } else {
      const lastLoaded = chaptersRef.current[chaptersRef.current.length - 1];
      if (lastLoaded && ttsChapter === lastLoaded.chapterIndex + 1) appendNextChapter();
    }
  }, [
    ttsActive,
    ttsChapter,
    ttsParagraph,
    ttsPosKey,
    detached,
    chapters,
    renderCounts,
    appendNextChapter,
    pruneIfNeeded,
  ]);

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
    <div className={cn('relative h-full', `theme-${theme}`)}>
      <div
        ref={containerRef}
        className="no-scrollbar h-full overflow-y-auto"
        style={{
          backgroundColor: 'var(--reader-bg)',
          color: 'var(--reader-fg)',
          overflowAnchor: 'none', // pruning compensates scrollTop manually
        }}
      >
        <div
          className="mx-auto w-full max-w-2xl px-5 pb-24"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight,
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)',
          }}
        >
          {chapters.map((ch) => (
            <section
              key={ch.id}
              ref={(el) => {
                if (el) sectionRefs.current.set(ch.chapterIndex, el);
                else sectionRefs.current.delete(ch.chapterIndex);
              }}
            >
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
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setDetached(false);
                      onSpeakFrom(ch.chapterIndex, i);
                    }}
                    className={cn(
                      'reader-paragraph mb-[0.9em] rounded-md transition-colors duration-300',
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

      {/* Visual detachment: snap back to the spoken paragraph */}
      {ttsActive && detached && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDetached(false);
          }}
          className="absolute bottom-28 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-medium text-on-accent shadow-lg transition-colors hover:bg-accent-hov"
        >
          <AudioLines className="h-4 w-4" aria-hidden="true" />
          Return to audio
        </button>
      )}
    </div>
  );
});
