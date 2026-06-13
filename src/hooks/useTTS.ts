import { useEffect, useMemo, useRef } from 'react';
import { db, type Chapter } from '../db/db';
import { useTtsStore, type TtsStatus } from '../store/ttsStore';
import { useReaderStore } from '../store/readerStore';
import { applyFixes, compileRules, type CompiledRule } from '../lib/textFixer';

/**
 * TTS & MediaSession state machine (spec §5).
 *
 * - Silent Audio Hack: a looping 1s silent.mp3 in a hidden <audio> keeps the
 *   mobile audio session alive while window.speechSynthesis speaks.
 * - MediaSession Binding: play/pause/nexttrack/previoustrack lock-screen
 *   actions are bound to the engine.
 * - Event Bridge: when the lock screen pauses the silent audio, the audio
 *   element's pause event immediately pauses speechSynthesis (and vice versa).
 * - Smart Pacing: the next utterance is wrapped in a setTimeout; paragraphs
 *   ending in `"` or `!` inject a 600ms delay, others a short beat.
 * - Translation Fixer: every paragraph passes through textFixer with the
 *   active DictionaryRules pulled from Dexie at session start.
 */

const PAUSE_AFTER_QUOTE_OR_BANG_MS = 600;
const PAUSE_BETWEEN_PARAGRAPHS_MS = 200;
const CHAPTER_TITLE_PAUSE_MS = 2000; // breath before announcing a new chapter
const KEEPALIVE_INTERVAL_MS = 10_000;

/**
 * Perceptual scaling: most speech engines turn to mumble past ~1.6x, so the
 * upper half of the slider is compressed on a power curve — UI 2.0x maps to
 * ~1.6 engine rate, 1.5x to ~1.32. Below 1x stays linear (slow speech is fine).
 */
const toEngineRate = (ui: number): number => (ui <= 1 ? ui : Math.pow(ui, 0.68));
const toEnginePitch = (ui: number): number => (ui <= 1 ? ui : Math.pow(ui, 0.7));

export interface TtsEngine {
  start: (chapterIndex: number, paragraphIndex: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Skip ±1 paragraph (also bound to lock-screen next/previous track). */
  skip: (delta: number) => void;
  /** Re-speak the current paragraph after a rate/pitch/voice change. */
  refreshSettings: () => void;
}

export function useTTS(
  novelId: string | undefined,
  totalChapters: number,
  novelTitle: string,
  cover?: Blob,
): TtsEngine {
  // Live props mirrored into refs so the stable engine closure reads fresh values
  const novelIdRef = useRef(novelId);
  novelIdRef.current = novelId;
  const totalChaptersRef = useRef(totalChapters);
  totalChaptersRef.current = totalChapters;
  const novelTitleRef = useRef(novelTitle);
  novelTitleRef.current = novelTitle;

  const artworkUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cover) {
      artworkUrlRef.current = null;
      return;
    }
    const url = URL.createObjectURL(cover);
    artworkUrlRef.current = url;
    return () => {
      artworkUrlRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [cover]);

  const engine = useMemo<TtsEngine>(() => {
    // ----- engine-internal state (closure-scoped, never re-created) -----
    const chapterRef: { current: Chapter | null } = { current: null };
    let paragraphIndex = 0;
    let rules: CompiledRule[] = [];
    let audio: HTMLAudioElement | null = null;
    let timer: number | null = null;
    let status: TtsStatus = 'idle';
    let generation = 0; // invalidates stale onend callbacks after cancel/skip
    let suppressAudioEvents = false;

    const synth = (): SpeechSynthesis | null =>
      'speechSynthesis' in window ? window.speechSynthesis : null;

    const clearTimer = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const setStatus = (s: TtsStatus): void => {
      status = s;
      useTtsStore.getState().setStatus(s);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState =
          s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
      }
    };

    /** Control the silent loop without triggering the event bridge. */
    const silentCtl = (op: 'play' | 'pause'): void => {
      if (!audio) return;
      suppressAudioEvents = true;
      if (op === 'play') void audio.play().catch(() => undefined);
      else audio.pause();
      window.setTimeout(() => {
        suppressAudioEvents = false;
      }, 300);
    };

    const ensureAudio = (): void => {
      if (audio) return;
      audio = new Audio('/silent.mp3');
      audio.loop = true;
      audio.volume = 0.01; // inaudible but keeps the session "audible" to the OS
      // THE EVENT BRIDGE (spec §5): lock-screen pause -> speechSynthesis.pause()
      audio.addEventListener('pause', () => {
        if (!suppressAudioEvents && status === 'playing') pause(true);
      });
      audio.addEventListener('play', () => {
        if (!suppressAudioEvents && status === 'paused') resume(true);
      });
    };

    const updateMetadata = (chapterTitle: string): void => {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapterTitle,
        artist: novelTitleRef.current,
        album: 'Cicada',
        artwork: artworkUrlRef.current
          ? [{ src: artworkUrlRef.current, sizes: '512x512' }]
          : [],
      });
    };

    const setupMediaSession = (chapterTitle: string): void => {
      if (!('mediaSession' in navigator)) return;
      updateMetadata(chapterTitle);
      navigator.mediaSession.setActionHandler('play', () => resume());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
      try {
        navigator.mediaSession.setActionHandler('stop', () => stop());
      } catch {
        /* 'stop' unsupported on some platforms */
      }
    };

    const makeUtterance = (text: string): SpeechSynthesisUtterance => {
      const utterance = new SpeechSynthesisUtterance(text);
      const { rate, pitch, voiceURI } = useTtsStore.getState();
      utterance.rate = toEngineRate(rate);
      utterance.pitch = toEnginePitch(pitch);
      if (voiceURI) {
        const voice = synth()?.getVoices().find((v) => v.voiceURI === voiceURI);
        if (voice) utterance.voice = voice;
      }
      return utterance;
    };

    /** Announce the current chapter's title, then continue into paragraph 0. */
    const speakChapterTitle = (): void => {
      const s = synth();
      const ch = chapterRef.current;
      if (!s || !ch || status !== 'playing') return;
      const gen = ++generation;
      const utterance = makeUtterance(applyFixes(ch.title, rules));
      utterance.onend = () => {
        if (gen !== generation || status !== 'playing') return;
        timer = window.setTimeout(speakCurrent, PAUSE_AFTER_QUOTE_OR_BANG_MS);
      };
      utterance.onerror = () => {
        if (gen === generation && status === 'playing') {
          timer = window.setTimeout(speakCurrent, 300);
        }
      };
      s.speak(utterance);
      useTtsStore.getState().setTtsPosition(ch.chapterIndex, 0);
      useReaderStore.getState().setPosition(ch.chapterIndex, 0);
    };

    const speakCurrent = (): void => {
      const s = synth();
      const ch = chapterRef.current;
      if (!s || !ch) return;
      const idx = paragraphIndex;
      const raw = ch.paragraphs[idx] ?? '';
      const text = applyFixes(raw, rules); // Translation Fixer pipeline
      const gen = ++generation;

      const utterance = makeUtterance(text);

      utterance.onend = () => {
        if (gen !== generation || status !== 'playing') return;
        // SMART PACING (spec §5): 600ms after dialogue/exclamations
        const delay = /["”'!]\s*$/.test(raw)
          ? PAUSE_AFTER_QUOTE_OR_BANG_MS
          : PAUSE_BETWEEN_PARAGRAPHS_MS;
        timer = window.setTimeout(advanceParagraph, delay);
      };
      utterance.onerror = () => {
        // Skip ahead rather than stalling on an engine hiccup
        if (gen === generation && status === 'playing') {
          timer = window.setTimeout(advanceParagraph, 300);
        }
      };

      s.speak(utterance);
      // Publish position: highlighter + reading progress stay in sync (spec Phase 4)
      useTtsStore.getState().setTtsPosition(ch.chapterIndex, idx);
      useReaderStore.getState().setPosition(ch.chapterIndex, idx);
    };

    const advanceParagraph = (): void => {
      const ch = chapterRef.current;
      if (!ch) return;
      if (paragraphIndex + 1 < ch.paragraphs.length) {
        paragraphIndex += 1;
        speakCurrent();
      } else {
        void advanceChapter();
      }
    };

    const advanceChapter = async (): Promise<void> => {
      const id = novelIdRef.current;
      const ch = chapterRef.current;
      if (!id || !ch) {
        stop();
        return;
      }
      const nextIndex = ch.chapterIndex + 1;
      if (nextIndex >= totalChaptersRef.current) {
        stop(); // end of book
        return;
      }
      const next = await db.chapters.get(`${id}_${nextIndex}`);
      if (!next || status === 'idle') {
        stop();
        return;
      }
      chapterRef.current = next;
      paragraphIndex = 0;
      updateMetadata(next.title);
      // 2s breath, then announce the chapter title, then read on (user request)
      timer = window.setTimeout(speakChapterTitle, CHAPTER_TITLE_PAUSE_MS);
    };

    const start = async (chapterIndex: number, startParagraph: number): Promise<void> => {
      const id = novelIdRef.current;
      const s = synth();
      if (!id || !s) return;
      const [dictRules, ch] = await Promise.all([
        db.dictionary.where('novelId').anyOf(id, 'global').toArray(),
        db.chapters.get(`${id}_${chapterIndex}`),
      ]);
      if (!ch) return;
      rules = compileRules(dictRules);
      chapterRef.current = ch;
      paragraphIndex = Math.min(Math.max(startParagraph, 0), ch.paragraphs.length - 1);
      generation++;
      clearTimer();
      s.cancel();
      ensureAudio();
      silentCtl('play'); // must happen inside the user gesture chain
      setupMediaSession(ch.title);
      setStatus('playing');
      // Starting at the top of a chapter? Announce its title first.
      if (paragraphIndex === 0) speakChapterTitle();
      else speakCurrent();
    };

    const pause = (fromAudio = false): void => {
      const s = synth();
      if (!s || status !== 'playing') return;
      clearTimer();
      s.pause();
      if (!fromAudio) silentCtl('pause');
      setStatus('paused');
      // Some engines (Android Chrome) ignore pause(); cancel so audio actually
      // stops — resume()'s fallback will re-speak the current paragraph.
      window.setTimeout(() => {
        if (status === 'paused' && s.speaking && !s.paused) {
          generation++;
          s.cancel();
        }
      }, 150);
    };

    const resume = (fromAudio = false): void => {
      const s = synth();
      if (!s || status !== 'paused') return;
      if (!fromAudio) silentCtl('play');
      s.resume();
      setStatus('playing');
      // Fallback: if the queue was dropped while paused, restart the paragraph
      window.setTimeout(() => {
        if (status === 'playing' && !s.speaking) speakCurrent();
      }, 400);
    };

    const stop = (): void => {
      const s = synth();
      generation++;
      clearTimer();
      s?.cancel();
      silentCtl('pause');
      setStatus('idle');
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    };

    const skip = (delta: number): void => {
      const s = synth();
      const ch = chapterRef.current;
      if (!s || !ch || status === 'idle') return;
      generation++;
      clearTimer();
      s.cancel();
      const target = paragraphIndex + delta;
      if (status === 'paused') {
        setStatus('playing');
        silentCtl('play');
      }
      if (target >= ch.paragraphs.length) {
        void advanceChapter();
        return;
      }
      paragraphIndex = Math.max(0, target);
      speakCurrent();
    };

    const refreshSettings = (): void => {
      const s = synth();
      if (!s || status !== 'playing') return;
      generation++;
      clearTimer();
      s.cancel();
      speakCurrent();
    };

    return { start, pause, resume, stop, skip, refreshSettings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrome desktop drops long sessions; periodic resume() keeps it alive
  const status = useTtsStore((s) => s.status);
  useEffect(() => {
    if (status !== 'playing') return;
    const id = window.setInterval(() => {
      const s = window.speechSynthesis;
      if (s && s.speaking && !s.paused) s.resume();
    }, KEEPALIVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status]);

  // Hard stop when the reader unmounts (navigation away)
  useEffect(() => () => engine.stop(), [engine]);

  return engine;
}
