import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Headphones, Loader2, Play, X } from 'lucide-react';
import { db } from '../../db/db';
import { useReaderStore } from '../../store/readerStore';
import { useTtsStore } from '../../store/ttsStore';
import { TopBar } from '../layout/TopBar';
import { ReaderViewport } from './ReaderViewport';
import { Pagination } from './Pagination';
import { ThemeToggle } from '../controls/ThemeToggle';
import { TypographySliders } from '../controls/TypographySliders';
import { TTSControls, TTSVoiceSettings } from '../controls/TTSControls';
import { DictionaryModal } from '../controls/DictionaryModal';
import { useTTS } from '../../hooks/useTTS';
import { useReadingStats } from '../../hooks/useReadingStats';
import { cn, uuid } from '../../lib/utils';

const PROGRESS_SAVE_DEBOUNCE_MS = 800;
const CHROME_HIDE_DELAY_MS = 3500;
const DEFAULT_WPM = 250;

interface Anchor {
  chapter: number;
  paragraph: number;
  key: number; // changes on explicit navigation -> remounts the viewport
}

export function ReaderPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const chapterParam = searchParams.get('chapter');

  const currentChapterIndex = useReaderStore((s) => s.currentChapterIndex);
  const currentParagraphIndex = useReaderStore((s) => s.currentParagraphIndex);
  const infinite = useReaderStore((s) => s.infiniteScroll);
  const setInfinite = useReaderStore((s) => s.setInfiniteScroll);
  const paged = useReaderStore((s) => s.pagedMode);
  const setPaged = useReaderStore((s) => s.setPagedMode);
  const openNovel = useReaderStore((s) => s.openNovel);
  const setPosition = useReaderStore((s) => s.setPosition);
  const theme = useReaderStore((s) => s.theme);

  const novel = useLiveQuery(() => (novelId ? db.novels.get(novelId) : undefined), [novelId]);

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /** What the user is visibly looking at — drives the status bar, NOT progress. */
  const [viewed, setViewed] = useState<{ chapter: number; fraction: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const wpmRef = useRef(DEFAULT_WPM);

  /** Live TTS status — used for sessionStorage crash-recovery tracking. */
  const ttsStatus = useTtsStore((s) => s.status);
  /** Shown after a crash/forced-kill: lets the user restart TTS with one tap. */
  const [resumePill, setResumePill] = useState<{ chapterIndex: number } | null>(null);

  /* --------------------------- audio engine -------------------------- */
  const tts = useTTS(novelId, novel?.totalChapters ?? 0, novel?.title ?? '', novel?.coverImage);

  const { chapterEtaMs } = useReadingStats(novelId, currentChapterIndex, currentParagraphIndex, wpmRef);

  const handleListen = useCallback(() => {
    const { currentChapterIndex: c, currentParagraphIndex: p } = useReaderStore.getState();
    void tts.start(c, p);
  }, [tts]);

  const handleSpeakFrom = useCallback(
    (chapterIndex: number, paragraphIndex: number) => {
      void tts.seekTo(chapterIndex, paragraphIndex);
    },
    [tts],
  );

  /** Selection-based note saving (spec Phase 5, native-selection refactor). */
  const handleSaveSelection = useCallback(
    (
      chapterIndex: number,
      startParagraphIndex: number,
      endParagraphIndex: number,
      selectedText: string,
    ) => {
      if (!novelId) return;
      void db.notes.put({
        id: uuid(),
        novelId,
        chapterIndex,
        startParagraphIndex,
        endParagraphIndex,
        selectedText,
        text: '', // direct save — no annotation step
        timestamp: Date.now(),
      });
    },
    [novelId],
  );

  /* ----------------------- auto-hiding chrome ----------------------- */
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setChromeVisible(false), CHROME_HIDE_DELAY_MS);
  }, [cancelHide]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  /** Tap anywhere on the page toggles the chrome (mobile/PWA pattern). */
  const toggleChrome = useCallback(() => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // user is selecting text
    setChromeVisible((v) => {
      if (!v) scheduleHide();
      else cancelHide();
      return !v;
    });
  }, [scheduleHide, cancelHide]);

  useEffect(() => {
    scheduleHide();
    return cancelHide;
  }, [scheduleHide, cancelHide]);

  /* ------------------- crash recoverability ----------------------- */

  // 1. On mount: check if TTS was playing when the tab last died (crash/kill).
  //    If so, show the resume pill and consume the flag so it is one-shot.
  useEffect(() => {
    if (!novelId) return;
    try {
      const raw = sessionStorage.getItem('cicada_was_listening');
      if (!raw) return;
      const saved = JSON.parse(raw) as { novelId: string; chapterIndex: number };
      if (saved.novelId === novelId) {
        setResumePill({ chapterIndex: saved.chapterIndex });
        sessionStorage.removeItem('cicada_was_listening');
      }
    } catch {
      sessionStorage.removeItem('cicada_was_listening');
    }
  }, [novelId]);

  // 2. Track TTS playback state in sessionStorage.
  //    Written while playing/paused so a crash preserves the flag.
  //    Cleared on idle (deliberate stop) so normal exits do not trigger the pill.
  useEffect(() => {
    if (!novelId) return;
    if (ttsStatus === 'playing' || ttsStatus === 'paused') {
      const { chapterIndex } = useTtsStore.getState();
      sessionStorage.setItem(
        'cicada_was_listening',
        JSON.stringify({ novelId, chapterIndex }),
      );
    } else {
      sessionStorage.removeItem('cicada_was_listening');
    }
  }, [ttsStatus, novelId]);

  // 3. Clean navigation away from the reader (not a crash) clears the flag.
  //    This fires on unmount; on a crash the cleanup never runs so the flag persists.
  useEffect(() => {
    return () => {
      sessionStorage.removeItem('cicada_was_listening');
    };
  }, []);

  // 4. Flush current position to IndexedDB immediately on pagehide / tab-hide
  //    so a crash or tab-kill does not lose more than the current debounce window.
  const ready = anchor !== null;
  useEffect(() => {
    if (!novelId || !ready) return;
    const flush = (): void => {
      const { currentChapterIndex, currentParagraphIndex } = useReaderStore.getState();
      void db.progress.put({
        novelId,
        currentChapterIndex,
        currentParagraphIndex,
        readingSpeedWPM: wpmRef.current,
        lastReadAt: Date.now(),
      });
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [novelId, ready]);

  // 5. Auto-dismiss resume pill once TTS is actually running.
  useEffect(() => {
    if (ttsStatus === 'playing') setResumePill(null);
  }, [ttsStatus]);

  /* ------------------------ position loading ------------------------ */
  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    setAnchor(null);
    void db.progress.get(novelId).then((p) => {
      if (cancelled) return;
      if (p) wpmRef.current = p.readingSpeedWPM;
      const fromParam = chapterParam !== null;
      const chapter = fromParam
        ? Math.max(0, Number(chapterParam) || 0)
        : p?.currentChapterIndex ?? 0;
      const paragraph = fromParam ? 0 : p?.currentParagraphIndex ?? 0;
      openNovel(novelId, chapter, paragraph);
      setAnchor({ chapter, paragraph, key: Date.now() });
      setViewed({ chapter, fraction: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [novelId, chapterParam, openNovel]);

  /* ----------------- debounced progress persistence ----------------- */
  useEffect(() => {
    if (!novelId || !ready) return;
    const t = setTimeout(() => {
      void db.progress.put({
        novelId,
        currentChapterIndex,
        currentParagraphIndex,
        readingSpeedWPM: wpmRef.current,
        lastReadAt: Date.now(),
      });
    }, PROGRESS_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [novelId, ready, currentChapterIndex, currentParagraphIndex]);

  /* --------------------------- navigation --------------------------- */
  /** Progress channel (audio-gated by the viewport while TTS is active). */
  const handlePosition = useCallback(
    (chapterIndex: number, paragraphIndex: number) => {
      setPosition(chapterIndex, paragraphIndex);
    },
    [setPosition],
  );

  /** Viewed channel — whatever is visibly on screen right now. */
  const handleViewed = useCallback(
    (chapterIndex: number, paragraphIndex: number, chapterLength: number) => {
      setViewed({
        chapter: chapterIndex,
        fraction: chapterLength > 1 ? paragraphIndex / (chapterLength - 1) : 1,
      });
    },
    [],
  );

  const goToChapter = useCallback(
    (index: number) => {
      if (!novel) return;
      tts.stop(); // manual navigation ends the listening session
      const clamped = Math.max(0, Math.min(novel.totalChapters - 1, index));
      setPosition(clamped, 0);
      setAnchor({ chapter: clamped, paragraph: 0, key: Date.now() });
      setViewed({ chapter: clamped, fraction: 0 });
      showChrome();
    },
    [novel, setPosition, showChrome, tts],
  );

  if (!novelId) return null;

  const barsVisible = chromeVisible || settingsOpen;
  // Status bar follows the chapter the user is LOOKING at, not the TTS chapter
  const viewedChapter = viewed?.chapter ?? currentChapterIndex;
  const chapterTitle = novel?.chapterTitles?.[viewedChapter] ?? `Chapter ${viewedChapter + 1}`;

  return (
    <main className={cn('relative h-full overflow-hidden', `theme-${theme}`)}>
      {anchor && novel ? (
        <div className="h-full" onClick={toggleChrome}>
          <ReaderViewport
            key={`${novelId}_${anchor.key}`}
            novelId={novelId}
            totalChapters={novel.totalChapters}
            startChapter={anchor.chapter}
            startParagraph={anchor.paragraph}
            infinite={infinite}
            paged={paged}
            onPositionChange={handlePosition}
            onViewedChange={handleViewed}
            onRequestChapter={goToChapter}
            onSpeakFrom={handleSpeakFrom}
            onSaveSelection={handleSaveSelection}
          />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-faint" aria-hidden="true" />
        </div>
      )}

      {/* Edge hover/tap zones to reveal the chrome when hidden */}
      {!barsVisible && (
        <>
          <div
            className="absolute inset-x-0 top-0 z-10 h-10"
            onMouseEnter={showChrome}
            onClick={toggleChrome}
          />
          <div
            className="absolute inset-x-0 bottom-0 z-10 h-12"
            onMouseEnter={showChrome}
            onClick={toggleChrome}
          />
        </>
      )}

      {/* Top chrome */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-20 transition-transform duration-300',
          barsVisible ? 'translate-y-0' : '-translate-y-full',
        )}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
      >
        <TopBar
          novelTitle={novel?.title ?? ''}
          chapterTitle={chapterTitle}
          backTo={`/book/${novelId}`}
          onOpenSettings={() => setSettingsOpen((o) => !o)}
        />
        {/* Resume-listening pill — appears after a crash/forced-kill */}
        {resumePill && ttsStatus === 'idle' && (
          <div className="flex justify-center px-4 pb-2 pt-1">
            <div className="flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 shadow-md">
              <Headphones className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="whitespace-nowrap text-xs text-main">
                Resume listening &mdash; Ch.&nbsp;{resumePill.chapterIndex + 1}
              </span>
              <button
                onClick={() => {
                  void handleListen();
                  setResumePill(null);
                }}
                aria-label="Resume listening"
                className="rounded-full bg-accent p-1 text-on-accent hover:bg-accent-hov"
              >
                <Play className="h-3 w-3 translate-x-[0.5px]" aria-hidden="true" />
              </button>
              <button
                onClick={() => setResumePill(null)}
                aria-label="Dismiss"
                className="p-0.5 text-faint hover:text-muted"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <div
          className="absolute right-3 z-30 flex w-72 flex-col gap-4 rounded-xl border border-edge bg-surface p-4 shadow-xl"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
          onMouseEnter={cancelHide}
        >
          <ThemeToggle />
          <TypographySliders />
          <TTSVoiceSettings onChanged={tts.refreshSettings} />
          <button
            onClick={() => {
              setSettingsOpen(false);
              setDictOpen(true);
            }}
            className="rounded-lg border border-edge px-3 py-2 text-xs text-muted transition-colors hover:bg-surface2 hover:text-main"
          >
            Translation fixer...
          </button>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>
              Infinite scrolling
              <span className="block text-[10px] text-faint">
                Next chapter flows in as one continuous page
              </span>
            </span>
            <input
              type="checkbox"
              checked={infinite}
              onChange={(e) => setInfinite(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>
              Tap to turn pages
              <span className="block text-[10px] text-faint">
                Tap the left/right side of the screen to flip a page back/forward
              </span>
            </span>
            <input
              type="checkbox"
              checked={paged}
              onChange={(e) => setPaged(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
          </label>
        </div>
      )}

      {/* Bottom chrome */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 transition-transform duration-300',
          barsVisible ? 'translate-y-0' : 'translate-y-full',
        )}
        onMouseEnter={cancelHide}
        onMouseLeave={scheduleHide}
      >
        <TTSControls
          barsVisible={barsVisible}
          onListen={handleListen}
          onPause={tts.pause}
          onResume={tts.resume}
          onStop={tts.stop}
          onSkip={tts.skip}
        />
        <Pagination
          chapterIndex={viewedChapter}
          totalChapters={novel?.totalChapters ?? 0}
          chapterFraction={viewed?.fraction ?? 0}
          chapterEtaMs={chapterEtaMs}
          onNavigate={goToChapter}
        />
      </div>

      {/* Translation Fixer rules (spec Phase 5) */}
      {dictOpen && (
        <DictionaryModal
          novelId={novelId}
          onClose={() => {
            setDictOpen(false);
            void tts.reloadRules(); // apply edits to the live session
          }}
        />
      )}
    </main>
  );
}
