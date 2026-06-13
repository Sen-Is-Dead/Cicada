import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Loader2 } from 'lucide-react';
import { db } from '../../db/db';
import { useReaderStore } from '../../store/readerStore';
import { TopBar } from '../layout/TopBar';
import { ReaderViewport } from './ReaderViewport';
import { Pagination } from './Pagination';
import { ThemeToggle } from '../controls/ThemeToggle';
import { TypographySliders } from '../controls/TypographySliders';
import { TTSControls, TTSVoiceSettings } from '../controls/TTSControls';
import { useTTS } from '../../hooks/useTTS';
import { cn } from '../../lib/utils';

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
  const openNovel = useReaderStore((s) => s.openNovel);
  const setPosition = useReaderStore((s) => s.setPosition);

  const novel = useLiveQuery(() => (novelId ? db.novels.get(novelId) : undefined), [novelId]);

  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [chapterFraction, setChapterFraction] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wpmRef = useRef(DEFAULT_WPM);

  /* --------------------------- audio engine -------------------------- */
  const tts = useTTS(novelId, novel?.totalChapters ?? 0, novel?.title ?? '', novel?.coverImage);

  const handleListen = useCallback(() => {
    const { currentChapterIndex: c, currentParagraphIndex: p } = useReaderStore.getState();
    void tts.start(c, p);
  }, [tts]);

  const handleSpeakFrom = useCallback(
    (chapterIndex: number, paragraphIndex: number) => {
      void tts.start(chapterIndex, paragraphIndex);
    },
    [tts],
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
    });
    return () => {
      cancelled = true;
    };
  }, [novelId, chapterParam, openNovel]);

  /* ----------------- debounced progress persistence ----------------- */
  const ready = anchor !== null;
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
  const handlePosition = useCallback(
    (chapterIndex: number, paragraphIndex: number, chapterLength: number) => {
      setPosition(chapterIndex, paragraphIndex);
      setChapterFraction(chapterLength > 1 ? paragraphIndex / (chapterLength - 1) : 1);
    },
    [setPosition],
  );

  const goToChapter = useCallback(
    (index: number) => {
      if (!novel) return;
      tts.stop(); // manual navigation ends the listening session
      const clamped = Math.max(0, Math.min(novel.totalChapters - 1, index));
      setPosition(clamped, 0);
      setChapterFraction(0);
      setAnchor({ chapter: clamped, paragraph: 0, key: Date.now() });
      showChrome();
    },
    [novel, setPosition, showChrome, tts],
  );

  if (!novelId) return null;

  const barsVisible = chromeVisible || settingsOpen;
  const chapterTitle =
    novel?.chapterTitles?.[currentChapterIndex] ?? `Chapter ${currentChapterIndex + 1}`;

  return (
    <main className="relative h-full overflow-hidden">
      {anchor && novel ? (
        <div className="h-full" onClick={toggleChrome}>
          <ReaderViewport
            key={`${novelId}_${anchor.key}`}
            novelId={novelId}
            totalChapters={novel.totalChapters}
            startChapter={anchor.chapter}
            startParagraph={anchor.paragraph}
            infinite={infinite}
            onPositionChange={handlePosition}
            onRequestChapter={goToChapter}
            onSpeakFrom={handleSpeakFrom}
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
          onListen={handleListen}
          onPause={tts.pause}
          onResume={tts.resume}
          onStop={tts.stop}
          onSkip={tts.skip}
        />
        <Pagination
          chapterIndex={currentChapterIndex}
          totalChapters={novel?.totalChapters ?? 0}
          chapterFraction={chapterFraction}
          onNavigate={goToChapter}
        />
      </div>
    </main>
  );
}
