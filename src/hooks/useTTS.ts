import { useEffect, useMemo, useRef } from 'react';
import { db, type Chapter } from '../db/db';
import {
  TTS_MAX_PITCH,
  TTS_MAX_RATE,
  TTS_MIN_PITCH,
  TTS_MIN_RATE,
  useTtsStore,
  type TtsStatus,
} from '../store/ttsStore';
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

const PAUSE_AFTER_QUOTE_OR_BANG_MS = 200;
const PAUSE_BETWEEN_PARAGRAPHS_MS = 75;
const CHAPTER_TITLE_PAUSE_MS = 750; // breath before announcing a new chapter
const KEEPALIVE_INTERVAL_MS = 10_000;

/**
 * Mobile Web Speech engines (Android Chrome, iOS Safari) need the queue to fully
 * settle before speak() — otherwise the first word(s) of an utterance are clipped.
 * We flush, wait this long, then speak. Desktop speaks immediately (settle = 0).
 */
const MOBILE_SPEAK_SETTLE_MS = 150;

const IS_MOBILE =
  typeof navigator !== 'undefined' &&
  (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as desktop Safari; detect via touch points
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// iOS Safari boots speechSynthesis in a *paused* state, so the very first
// speak() of a session queues but never plays until resume() is called once.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Hard engine ceilings (also clamps stale persisted values from older builds)
const clampRate = (v: number): number => Math.min(TTS_MAX_RATE, Math.max(TTS_MIN_RATE, v));
const clampPitch = (v: number): number => Math.min(TTS_MAX_PITCH, Math.max(TTS_MIN_PITCH, v));

export interface TtsEngine {
  start: (chapterIndex: number, paragraphIndex: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Skip ±1 paragraph (also bound to lock-screen next/previous track). */
  skip: (delta: number) => void;
  /**
   * Jump the active session to an exact paragraph (double-tap-to-seek).
   * Updates the stores immediately, cancels the current utterance in place,
   * and speaks from the target without restarting the session. Starts a new
   * session if idle.
   */
  seekTo: (chapterIndex: number, paragraphIndex: number) => Promise<void>;
  /** Re-speak the current paragraph after a rate/pitch/voice change. */
  refreshSettings: () => void;
  /** Re-fetch dictionary rules (after edits in the Translation Fixer UI). */
  reloadRules: () => Promise<void>;
  /** Recover playback if the OS suspended the engine while backgrounded. */
  nudge: () => void;
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

    /**
     * Publish a real media-session position (chapter length as duration,
     * paragraph as position) so Android/iOS see a deliberate, fully-featured
     * media session — which makes the OS less likely to cull the background
     * audio as a rogue process.
     */
    const updatePositionState = (): void => {
      if (
        !('mediaSession' in navigator) ||
        typeof navigator.mediaSession.setPositionState !== 'function'
      )
        return;
      const ch = chapterRef.current;
      if (!ch) return;
      const duration = Math.max(1, ch.paragraphs.length);
      const position = Math.min(Math.max(paragraphIndex, 0), duration);
      const { rate } = useTtsStore.getState();
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position,
          playbackRate: clampRate(rate),
        });
      } catch {
        /* invalid position state — ignore */
      }
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
      // Lock-screen scrubber + seek buttons map to paragraph navigation, so the
      // session exposes the full transport the OS expects from real media.
      try {
        navigator.mediaSession.setActionHandler('seekforward', () => skip(1));
        navigator.mediaSession.setActionHandler('seekbackward', () => skip(-1));
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          const cur = chapterRef.current;
          if (!cur || details.seekTime == null) return;
          void seekTo(cur.chapterIndex, Math.round(details.seekTime));
        });
      } catch {
        /* seek actions unsupported on some platforms */
      }
    };

    const makeUtterance = (text: string): SpeechSynthesisUtterance => {
      const utterance = new SpeechSynthesisUtterance(text);
      const { rate, pitch, volume, voiceURI } = useTtsStore.getState();
      utterance.rate = clampRate(rate);
      utterance.pitch = clampPitch(pitch);
      utterance.volume = Math.min(1, Math.max(0, volume));
      if (voiceURI) {
        const voice = synth()?.getVoices().find((v) => v.voiceURI === voiceURI);
        if (voice) utterance.voice = voice;
      }
      return utterance;
    };

    /**
     * Speak an utterance safely on every platform.
     *
     * On mobile the engine drops the start of a paragraph when speak() races a
     * not-yet-settled queue (e.g. right after a chained onend, a cancel, or the
     * lock-screen resume). We always flush first, then on mobile defer the speak
     * by a short settle so the engine is clean before it starts. The generation
     * guard cancels the deferred speak if the user skips/seeks/pauses meanwhile.
     */
    const speakUtterance = (utterance: SpeechSynthesisUtterance, gen: number): void => {
      const s = synth();
      if (!s) return;
      s.cancel(); // flush any residual/stuck utterance before starting a new one
      const fire = (): void => {
        if (gen !== generation || status !== 'playing') return;
        s.speak(utterance);
        // iOS Safari queues the utterance in a paused state on the first speak()
        // of a session — it shows as "playing" but stays silent until resumed.
        // A resume() right after speak() kicks it into actually playing.
        if (IS_IOS) s.resume();
      };
      if (IS_MOBILE) {
        timer = window.setTimeout(fire, MOBILE_SPEAK_SETTLE_MS);
      } else {
        fire();
      }
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
      speakUtterance(utterance, gen);
      useTtsStore.getState().setTtsPosition(ch.chapterIndex, 0);
      useReaderStore.getState().setPosition(ch.chapterIndex, 0);
      updatePositionState();
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

      speakUtterance(utterance, gen);
      // Publish position: highlighter + reading progress stay in sync (spec Phase 4)
      useTtsStore.getState().setTtsPosition(ch.chapterIndex, idx);
      useReaderStore.getState().setPosition(ch.chapterIndex, idx);
      updatePositionState();
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

    const seekTo = async (targetChapter: number, targetParagraph: number): Promise<void> => {
      if (status === 'idle') {
        await start(targetChapter, targetParagraph);
        return;
      }
      // Immediate store update so highlight/progress react before audio does
      useTtsStore.getState().setTtsPosition(targetChapter, targetParagraph);
      useReaderStore.getState().setPosition(targetChapter, targetParagraph);
      generation++;
      clearTimer();
      synth()?.cancel(); // stop the current sentence mid-word
      let ch = chapterRef.current;
      if (!ch || ch.chapterIndex !== targetChapter) {
        const id = novelIdRef.current;
        if (!id) return;
        const next = await db.chapters.get(`${id}_${targetChapter}`);
        if (!next) return;
        chapterRef.current = next;
        ch = next;
        updateMetadata(next.title);
      }
      paragraphIndex = Math.min(Math.max(targetParagraph, 0), ch.paragraphs.length - 1);
      if (status === 'paused') {
        setStatus('playing');
        silentCtl('play');
      }
      speakCurrent();
    };

    const reloadRules = async (): Promise<void> => {
      const id = novelIdRef.current;
      if (!id) return;
      const dictRules = await db.dictionary.where('novelId').anyOf(id, 'global').toArray();
      rules = compileRules(dictRules); // applies from the next utterance onward
    };

    const refreshSettings = (): void => {
      const s = synth();
      if (!s || status !== 'playing') return;
      generation++;
      clearTimer();
      s.cancel();
      speakCurrent();
    };

    /**
     * Recover playback after the OS suspended the speech engine in the
     * background (common on Android when the app is minimised or the screen
     * turns off). If we still believe we're playing but the engine has gone
     * silent OUTSIDE a deliberate pacing gap (timer === null), continue the
     * current paragraph; if it merely paused, resume. Never interrupts speech
     * that is actually still playing, so it cannot cause start-of-word clipping.
     */
    const nudge = (): void => {
      const s = synth();
      if (!s || status !== 'playing') return;
      if (s.paused) {
        s.resume();
        return;
      }
      if (!s.speaking && timer === null) speakCurrent();
    };

    return { start, pause, resume, stop, skip, seekTo, refreshSettings, reloadRules, nudge };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chrome DESKTOP drops long sessions; periodic resume() keeps it alive.
  // On mobile this same resume() clips the start of the utterance that happens
  // to be starting when the interval fires, and the silent-audio hack already
  // keeps the mobile session alive, so the keepalive is desktop-only.
  const status = useTtsStore((s) => s.status);
  useEffect(() => {
    if (status !== 'playing' || IS_MOBILE) return;
    const id = window.setInterval(() => {
      const s = window.speechSynthesis;
      if (s && s.speaking && !s.paused) s.resume();
    }, KEEPALIVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status]);

  // Mobile: Android (and iOS) suspend speechSynthesis while the app is
  // backgrounded. When the page returns to the foreground we continue from where
  // playback died; we also poll while it's minimised-but-visible, since timers
  // keep running (throttled) in that state. nudge() is a no-op during normal
  // playback and during pacing gaps, so it only acts when the engine has died.
  useEffect(() => {
    if (!IS_MOBILE || status !== 'playing') return;
    const onVisible = (): void => {
      if (!document.hidden) engine.nudge();
    };
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => engine.nudge(), 4000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [status, engine]);

  // Hard stop when the reader unmounts (navigation away)
  useEffect(() => () => engine.stop(), [engine]);

  return engine;
}
