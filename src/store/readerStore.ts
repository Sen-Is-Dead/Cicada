import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Zustand: reader UI state (spec §3) — font size, theme, current paragraph.
 * Only typography preferences are persisted (a few bytes — localStorage is
 * fine here; the "no localStorage" non-negotiable applies to text data,
 * which lives exclusively in IndexedDB). Reading position is persisted to
 * db.progress, not here.
 */

export type ReaderTheme = 'dark' | 'light' | 'sepia';

export type UiMode = 'dark' | 'light';

export type AccentId =
  | 'emerald'
  | 'red'
  | 'sky'
  | 'blue'
  | 'pink'
  | 'purple'
  | 'orange'
  | 'amber';

interface ReaderState {
  // Preferences (persisted)
  fontSize: number; // px
  lineHeight: number; // unitless multiplier
  theme: ReaderTheme;
  infiniteScroll: boolean; // chapters flow into each other as one page
  uiMode: UiMode; // whole-app light/dark
  accent: AccentId; // whole-app accent colour
  // Session position (synced to db.progress by ReaderPage)
  currentNovelId: string | null;
  currentChapterIndex: number;
  currentParagraphIndex: number;
  // Actions
  setFontSize: (fontSize: number) => void;
  setLineHeight: (lineHeight: number) => void;
  setTheme: (theme: ReaderTheme) => void;
  setInfiniteScroll: (infiniteScroll: boolean) => void;
  setUiMode: (uiMode: UiMode) => void;
  setAccent: (accent: AccentId) => void;
  openNovel: (novelId: string, chapterIndex: number, paragraphIndex: number) => void;
  setChapter: (chapterIndex: number) => void;
  setParagraph: (paragraphIndex: number) => void;
  /** Atomic chapter+paragraph update (infinite scroll crosses chapters). */
  setPosition: (chapterIndex: number, paragraphIndex: number) => void;
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      fontSize: 18,
      lineHeight: 1.7,
      theme: 'dark',
      infiniteScroll: true,
      uiMode: 'dark',
      accent: 'emerald',
      currentNovelId: null,
      currentChapterIndex: 0,
      currentParagraphIndex: 0,

      setFontSize: (fontSize) => set({ fontSize }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setTheme: (theme) => set({ theme }),
      setInfiniteScroll: (infiniteScroll) => set({ infiniteScroll }),
      setUiMode: (uiMode) => set({ uiMode }),
      setAccent: (accent) => set({ accent }),
      openNovel: (currentNovelId, currentChapterIndex, currentParagraphIndex) =>
        set({ currentNovelId, currentChapterIndex, currentParagraphIndex }),
      setChapter: (currentChapterIndex) =>
        set({ currentChapterIndex, currentParagraphIndex: 0 }),
      setParagraph: (currentParagraphIndex) => set({ currentParagraphIndex }),
      setPosition: (currentChapterIndex, currentParagraphIndex) =>
        set({ currentChapterIndex, currentParagraphIndex }),
    }),
    {
      name: 'cicada-reader-settings',
      partialize: (s) => ({
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        theme: s.theme,
        infiniteScroll: s.infiniteScroll,
        uiMode: s.uiMode,
        accent: s.accent,
      }),
    },
  ),
);
