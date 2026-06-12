import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Zustand: audio state (spec §3) — playing status, rate, pitch, voice, and the
 * paragraph currently being spoken (consumed by ReaderViewport's highlighter).
 * Decoupled from readerStore so the reader UI and the audio engine never
 * re-render each other unnecessarily.
 */

export type TtsStatus = 'idle' | 'playing' | 'paused';

interface TtsState {
  status: TtsStatus;
  rate: number; // 0.5–2
  pitch: number; // 0.5–2
  voiceURI: string | null; // null = system default
  // Paragraph currently being spoken
  chapterIndex: number;
  paragraphIndex: number;
  setStatus: (status: TtsStatus) => void;
  setRate: (rate: number) => void;
  setPitch: (pitch: number) => void;
  setVoiceURI: (voiceURI: string | null) => void;
  setTtsPosition: (chapterIndex: number, paragraphIndex: number) => void;
}

export const useTtsStore = create<TtsState>()(
  persist(
    (set) => ({
      status: 'idle',
      rate: 1,
      pitch: 1,
      voiceURI: null,
      chapterIndex: 0,
      paragraphIndex: 0,
      setStatus: (status) => set({ status }),
      setRate: (rate) => set({ rate }),
      setPitch: (pitch) => set({ pitch }),
      setVoiceURI: (voiceURI) => set({ voiceURI }),
      setTtsPosition: (chapterIndex, paragraphIndex) => set({ chapterIndex, paragraphIndex }),
    }),
    {
      name: 'cicada-tts-settings',
      partialize: (s) => ({ rate: s.rate, pitch: s.pitch, voiceURI: s.voiceURI }),
    },
  ),
);
