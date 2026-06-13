import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Zustand: audio state (spec §3) — playing status, rate, pitch, voice, and the
 * paragraph currently being spoken (consumed by ReaderViewport's highlighter).
 * Decoupled from readerStore so the reader UI and the audio engine never
 * re-render each other unnecessarily.
 */

export type TtsStatus = 'idle' | 'playing' | 'paused';

/**
 * Absolute engine ceilings. Speech turns to mumble past ~1.6x rate, and pitch
 * above ~1.4 sounds robotic — the sliders use these same bounds, so the UI
 * value IS the engine value (no hidden remapping).
 */
export const TTS_MIN_RATE = 0.5;
export const TTS_MAX_RATE = 1.6;
export const TTS_MIN_PITCH = 0.5;
export const TTS_MAX_PITCH = 1.4;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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
      setRate: (rate) => set({ rate: clamp(rate, TTS_MIN_RATE, TTS_MAX_RATE) }),
      setPitch: (pitch) => set({ pitch: clamp(pitch, TTS_MIN_PITCH, TTS_MAX_PITCH) }),
      setVoiceURI: (voiceURI) => set({ voiceURI }),
      setTtsPosition: (chapterIndex, paragraphIndex) => set({ chapterIndex, paragraphIndex }),
    }),
    {
      name: 'cicada-tts-settings',
      partialize: (s) => ({ rate: s.rate, pitch: s.pitch, voiceURI: s.voiceURI }),
    },
  ),
);
