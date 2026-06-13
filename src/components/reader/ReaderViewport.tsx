import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AudioLines, ChevronRight, StickyNote } from 'lucide-react';
import { db, type Chapter, type Note } from '../../db/db';
import { useReaderStore } from '../../store/readerStore';
import { useTtsStore } from '../../store/ttsStore';
import { cn } from '../../lib/utils';

const RENDER_CHUNK = 80;
/** Composite position key: chapterIndex * FACTOR + paragraphIndex. */
const POS_FACTOR = 1_000_000;
/** Re-enable auto-centering after this much input silence while detached. */
const REATTACH_DELAY_MS = 5000;
/** Two taps on the same paragraph within this window = seek. */
const DOUBLE_TAP_MS = 350;

interface SelectionMenuState {
  x: number; // viewport coordinates of the selection rect
  y: number;
  chapterIndex: number;
  start: number; // startParagraphIndex
  end: number; // endParagraphIndex (inclusive)
  text: string; // selection.toString()
}

interface ReaderViewportProps {
  novelId: string;
  totalChapters: number;
  startChapter: number;
  startParagraph: number;
  infinite: boolean;
  /** Owns reading progress (gated to the audio position while TTS is active). */
  onPositionChange: (chapterIndex: number, paragraphIndex: number, chapterLength: number) => void;
  /** Always fires with what's visibly on screen — drives the status bar. */
  onViewedChange: (chapterIndex: number, paragraphIndex: number, chapterLength: number) => void;
  /** Explicit navigation request (e.g. "Next chapter" button in paged mode). */
  onRequestChapter: (chapterIndex: number) => void;
  /** Double-tap on a paragraph: seek TTS to it. */
  onSpeakFrom: (chapterIndex: number, paragraphIndex: number) => void;
  /** Save-note action from the native-selection floating menu (spec Phase 5). */
  onSaveSelection: (
    chapterIndex: number,
    startParagraphIndex: number,
    endParagraphIndex: number,
    selectedText: string,
  ) => void;
}

/**
 * Multi-chapter sliding-window renderer. Paragraphs mount in chunks; with
 * infinite scroll, the next chapter is appended when the current one is fully
 * rendered (behind a scroll-snap chapter break that adds deliberate friction),
 * and chapters 2+ behind the reading position are unloaded with manual
 * scrollTop compensation so the page never jumps.
 */
export const ReaderViewport = memo(function ReaderViewport({
  novelId,
  totalChapters,
  startChapter,
  startParagraph,
  infinite,
  onPositionChange,
  onViewedChange,
  onRequestChapter,
  onSpeakFrom,
  onSaveSelection,
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
  /** Transient user-select suppression so double-taps don't highlight text. */
  const [suppressSelect, setSuppressSelect] = useState(false);
  /** Floating "Save note" menu over the active native selection. */
  const [selMenu, setSelMenu] = useState<SelectionMenuState | null>(null);

  // Paragraphs covered by saved notes -> underline marker in the renderer
  const notes = useLiveQuery(
    () => db.notes.where('novelId').equals(novelId).toArray(),
    [novelId],
    [] as Note[],
  );
  const notedKeys = useMemo(() => {
    const set = new Set<number>();
    for (const note of notes) {
      // Legacy notes (pre-selection schema) stored a single paragraphIndex
      const raw = note as Partial<Note> & { paragraphIndex?: number; chapterIndex: number };
      const start = raw.startParagraphIndex ?? raw.paragraphIndex ?? 0;
      const end = Math.min(raw.endParagraphIndex ?? start, start + 500);
      for (let p = start; p <= end; p++) set.add(raw.chapterIndex * POS_FACTOR + p);
    }
    return set;
  }, [notes]);

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
  const reattachTimerRef = useRef<number | null>(null);
  const suppressTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ key: number; time: number }>({ key: -1, time: 0 });
  const selChangeTimerRef = useRef<number | null>(null);

  // Mirror frequently-changing values into refs for stable observer callbacks
  const chaptersRef = useRef<Chapter[]>([]);
  chaptersRef.current = chapters;
  const renderCountsRef = useRef(renderCounts);
  renderCountsRef.current = renderCounts;
  const infiniteRef = useRef(infinite);
  infiniteRef.current = infinite;
  const onChangeRef = useRef(onPositionChange);
  onChangeRef.current = onPositionChange;
  const onViewedRef = useRef(onViewedChange);
  onViewedRef.current = onViewedChange;
  const ttsActiveRef = useRef(ttsActive);
  ttsActiveRef.current = ttsActive;
  const detachedRef = useRef(detached);
  detachedRef.current = detached;
  const selMenuRef = useRef<SelectionMenuState | null>(null);
  selMenuRef.current = selMenu;

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
   * Unload chapters 2+ behind the active reading position. The removed
   * section's height is subtracted from scrollTop in a layout effect, so the
   * visible text doesn't move a pixel.
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

  // Track the topmost visible paragraph -> viewed position + reading progress
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
          const len =
            chaptersRef.current.find((c) => c.chapterIndex === chapterIndex)?.paragraphs.length ??
            1;
          // The status bar always shows what the EYES see…
          onViewedRef.current(chapterIndex, paragraphIndex, len);
          // …but reading progress belongs to the audio while it's playing
          if (!ttsActiveRef.current) onChangeRef.current(chapterIndex, paragraphIndex, len);
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

  /* --------------- visual detachment + 8s reattach grace --------------- */

  const scheduleReattach = useCallback(() => {
    if (reattachTimerRef.current !== null) window.clearTimeout(reattachTimerRef.current);
    reattachTimerRef.current = window.setTimeout(() => setDetached(false), REATTACH_DELAY_MS);
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Manual input detaches; any further scrolling (incl. momentum) keeps the
    // 5s grace timer alive so we only snap back after true stillness.
    const onInput = (): void => {
      if (!ttsActiveRef.current) return;
      setDetached(true);
      scheduleReattach();
    };
    const onScroll = (): void => {
      if (detachedRef.current) scheduleReattach();
    };
    root.addEventListener('wheel', onInput, { passive: true });
    root.addEventListener('touchmove', onInput, { passive: true });
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('wheel', onInput);
      root.removeEventListener('touchmove', onInput);
      root.removeEventListener('scroll', onScroll);
      if (reattachTimerRef.current !== null) window.clearTimeout(reattachTimerRef.current);
    };
  }, [scheduleReattach]);

  useEffect(() => {
    if (!ttsActive) setDetached(false);
    if (!detached && reattachTimerRef.current !== null) {
      window.clearTimeout(reattachTimerRef.current);
      reattachTimerRef.current = null;
    }
  }, [ttsActive, detached]);

  /* ------------------- double-tap to seek (touch-safe) ------------------ */

  const handleParagraphTap = (chapterIdx: number, paragraphIdx: number): void => {
    const key = chapterIdx * POS_FACTOR + paragraphIdx;
    const now = Date.now();
    const last = lastTapRef.current;
    lastTapRef.current = { key, time: now };
    // Suppress text selection briefly so a double-tap never highlights words
    setSuppressSelect(true);
    if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = window.setTimeout(() => setSuppressSelect(false), 450);
    if (last.key === key && now - last.time < DOUBLE_TAP_MS) {
      lastTapRef.current = { key: -1, time: 0 };
      setDetached(false);
      onSpeakFrom(chapterIdx, paragraphIdx);
    }
  };

  /* --------- native text selection -> floating "Save note" menu --------- */

  const computeSelection = useCallback((): void => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelMenu(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setSelMenu(null);
      return;
    }
    // Walk up from the boundary nodes to the paragraph wrappers (data-pos)
    const findPosKey = (node: Node | null): number | null => {
      let current: Node | null = node;
      while (current) {
        if (current instanceof HTMLElement && current.dataset.pos !== undefined) {
          return Number(current.dataset.pos);
        }
        current = current.parentNode;
      }
      return null;
    };
    const anchorKey = findPosKey(sel.anchorNode);
    const focusKey = findPosKey(sel.focusNode);
    if (anchorKey === null || focusKey === null) {
      setSelMenu(null); // selection escaped the chapter text
      return;
    }
    const startKey = Math.min(anchorKey, focusKey);
    const endKey = Math.max(anchorKey, focusKey);
    const chapterIndex = Math.floor(startKey / POS_FACTOR);
    const start = startKey % POS_FACTOR;
    // Clamp cross-chapter selections to the starting chapter
    const sameChapter = Math.floor(endKey / POS_FACTOR) === chapterIndex;
    const chapterLen =
      chaptersRef.current.find((c) => c.chapterIndex === chapterIndex)?.paragraphs.length ?? 1;
    const end = sameChapter ? endKey % POS_FACTOR : chapterLen - 1;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelMenu({
      x: rect.left + rect.width / 2,
      y: rect.top,
      chapterIndex,
      start,
      end: Math.max(start, end),
      text,
    });
  }, []);

  // Keep the menu in sync with the live selection (and follow it on scroll)
  useEffect(() => {
    const onSelectionChange = (): void => {
      if (selChangeTimerRef.current !== null) window.clearTimeout(selChangeTimerRef.current);
      selChangeTimerRef.current = window.setTimeout(computeSelection, 250);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    const root = containerRef.current;
    const onScroll = (): void => {
      if (selMenuRef.current) computeSelection();
    };
    root?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      root?.removeEventListener('scroll', onScroll);
      if (selChangeTimerRef.current !== null) window.clearTimeout(selChangeTimerRef.current);
    };
  }, [computeSelection]);

  const saveSelection = (): void => {
    const menu = selMenuRef.current;
    if (!menu) return;
    window.getSelection()?.removeAllRanges();
    setSelMenu(null);
    onSaveSelection(menu.chapterIndex, menu.start, menu.end, menu.text);
  };

  // Follow the spoken paragraph: sync progress, auto-center (unless detached),
  // growing the window or appending the next chapter as needed
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
        onPointerUp={() => window.setTimeout(computeSelection, 50)}
        className="no-scrollbar h-full overflow-y-auto"
        style={{
          backgroundColor: 'var(--reader-bg)',
          color: 'var(--reader-fg)',
          overflowAnchor: 'none', // pruning compensates scrollTop manually
          // Strictly 1:1 linear touch tracking on mobile
          touchAction: 'pan-y',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
          // Chapter-boundary friction: proximity snap catches at the break,
          // a second deliberate gesture crosses it. Disabled while the TTS
          // auto-centering owns the scroll so smooth-centering isn't fought.
          scrollSnapType: ttsActive && !detached ? undefined : 'y proximity',
        }}
      >
        <div
          className={cn('mx-auto w-full max-w-2xl px-5 pb-24', suppressSelect && 'select-none')}
          style={{
            fontSize: `${fontSize}px`,
            lineHeight,
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)',
          }}
        >
          {chapters.map((ch) => {
            const count = renderCounts.get(ch.chapterIndex) ?? 0;
            const chapterDone = count >= ch.paragraphs.length;
            const followsInBook = ch.chapterIndex + 1 < totalChapters;
            return (
              <section
                key={ch.id}
                ref={(el) => {
                  if (el) sectionRefs.current.set(ch.chapterIndex, el);
                  else sectionRefs.current.delete(ch.chapterIndex);
                }}
              >
                <h2
                  className="mb-6 mt-4 font-semibold opacity-90 first:mt-0"
                  style={{ fontSize: '1.15em' }}
                >
                  {ch.title}
                </h2>
                {ch.paragraphs.slice(0, count).map((text, i) => {
                  const posKey = ch.chapterIndex * POS_FACTOR + i;
                  return (
                    <p
                      key={i}
                      data-pos={posKey}
                      ref={getRefCallback(posKey)}
                      onClick={() => handleParagraphTap(ch.chapterIndex, i)}
                      className={cn(
                        'reader-paragraph mb-[0.9em] rounded-md transition-colors duration-300',
                        notedKeys.has(posKey) &&
                          'underline decoration-accent/40 decoration-[1.5px] underline-offset-4',
                        ttsActive && posKey === ttsPosKey && '-mx-2 bg-accent/15 px-2',
                      )}
                    >
                      {text}
                    </p>
                  );
                })}

                {/* Chapter break: snap point adds deliberate friction (the "bounce") */}
                {chapterDone && followsInBook && infinite && (
                  <div
                    aria-hidden="true"
                    className="my-10 flex select-none flex-col items-center gap-2 py-10"
                    style={{ scrollSnapAlign: 'end', scrollSnapStop: 'always' }}
                  >
                    <div className="h-px w-2/3 bg-current opacity-20" />
                    <p className="text-xs uppercase tracking-widest opacity-40">
                      End of {ch.title}
                    </p>
                    <div className="h-px w-2/3 bg-current opacity-20" />
                  </div>
                )}
              </section>
            );
          })}

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

      {/* Floating action menu over the native selection */}
      {selMenu && (
        <div
          className="fixed z-30 -translate-x-1/2 -translate-y-full"
          style={{
            left: selMenu.x,
            top: Math.max(selMenu.y - 8, 64),
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              saveSelection();
            }}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-xs font-medium text-on-accent shadow-lg transition-colors hover:bg-accent-hov"
          >
            <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
            Save note
          </button>
        </div>
      )}

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
