import { useEffect, useState } from 'react';
import {
  Headphones,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Timer,
} from 'lucide-react';
import {
  TTS_MAX_PITCH,
  TTS_MAX_RATE,
  TTS_MIN_PITCH,
  TTS_MIN_RATE,
  useTtsStore,
} from '../../store/ttsStore';
import { cn } from '../../lib/utils';

/* ------------------------------ playback bar ------------------------------ */

const SLEEP_PRESETS_MIN = [10, 15, 20, 30, 45, 60];
const SLEEP_PRESETS_CH = [1, 2, 3, 4, 5];

// Volume control is desktop-only — phones/tablets use their hardware buttons,
// which already adjust the speech output, so a software slider is redundant there.
const IS_DESKTOP =
  typeof navigator === 'undefined' ||
  !(/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * The sleep timer can fire on either a wall-clock deadline ('time') or after a
 * number of chapters have been read ('chapters'). For the chapter mode we store
 * the absolute target chapterIndex; once the engine reaches it, playback pauses.
 */
type SleepState =
  | { kind: 'time'; until: number }
  | { kind: 'chapters'; target: number; count: number };

interface TTSControlsProps {
  /** Whether the reader chrome (top/bottom bars) is currently shown. */
  barsVisible: boolean;
  onListen: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: (delta: number) => void;
}

export function TTSControls({
  barsVisible,
  onListen,
  onPause,
  onResume,
  onStop,
  onSkip,
}: TTSControlsProps) {
  const status = useTtsStore((s) => s.status);
  const chapterIndex = useTtsStore((s) => s.chapterIndex);

  /* Sleep timer — fires on a minute deadline or after N chapters */
  const [sleep, setSleep] = useState<SleepState | null>(null);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [customCh, setCustomCh] = useState('');
  const [, setTick] = useState(0); // refresh the remaining-minutes label

  // Hiding the chrome (tap on the page) must also dismiss the sleep panel —
  // otherwise it floats alone at the bottom of the screen after the bars slide out.
  useEffect(() => {
    if (!barsVisible) setSleepOpen(false);
  }, [barsVisible]);

  // Time mode: poll the deadline
  useEffect(() => {
    if (sleep?.kind !== 'time') return;
    const id = window.setInterval(() => {
      if (Date.now() >= sleep.until) {
        setSleep(null);
        onPause(); // no-op unless playing
      } else {
        setTick((t) => t + 1);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [sleep, onPause]);

  // Chapter mode: pause once the engine reaches the target chapter
  useEffect(() => {
    if (sleep?.kind !== 'chapters') return;
    if (chapterIndex >= sleep.target) {
      setSleep(null);
      onPause();
    }
  }, [sleep, chapterIndex, onPause]);

  // Ending the session clears the timer
  useEffect(() => {
    if (status === 'idle') {
      setSleep(null);
      setSleepOpen(false);
    }
  }, [status]);

  const startSleepMinutes = (minutes: number): void => {
    const whole = Math.floor(minutes);
    if (!Number.isFinite(whole) || whole < 1) return;
    setSleep({ kind: 'time', until: Date.now() + whole * 60_000 });
    setSleepOpen(false);
    setCustomMin('');
  };

  const startSleepChapters = (count: number): void => {
    const whole = Math.floor(count);
    if (!Number.isFinite(whole) || whole < 1) return;
    // target is absolute: the chapter at which we've finished `count` chapters
    setSleep({ kind: 'chapters', target: chapterIndex + whole, count: whole });
    setSleepOpen(false);
    setCustomCh('');
  };

  const remainingMin =
    sleep?.kind === 'time' ? Math.max(1, Math.ceil((sleep.until - Date.now()) / 60_000)) : null;
  const remainingCh =
    sleep?.kind === 'chapters' ? Math.max(1, sleep.target - chapterIndex) : null;
  const sleepActive = sleep !== null;
  const sleepBadge =
    remainingMin !== null ? `${remainingMin}m` : remainingCh !== null ? `${remainingCh} ch` : null;

  if (status === 'idle') {
    return (
      <div className="flex justify-center border-t border-edge bg-app/90 px-4 py-2 backdrop-blur">
        <button
          onClick={onListen}
          className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hov"
        >
          <Headphones className="h-4 w-4" aria-hidden="true" />
          Listen
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-between border-t border-edge bg-app/90 px-4 py-2 backdrop-blur">
      {/* Left: sleep timer */}
      <div className="relative">
        <button
          onClick={() => setSleepOpen((o) => !o)}
          aria-label="Sleep timer"
          aria-expanded={sleepOpen}
          className={cn(
            'flex items-center gap-1 rounded-md p-1.5 text-xs transition-colors hover:bg-surface2',
            sleepActive ? 'text-accent' : 'text-muted hover:text-main',
          )}
        >
          <Timer className="h-5 w-5" />
          {sleepBadge !== null && <span className="font-medium">{sleepBadge}</span>}
        </button>

        {sleepOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-edge bg-surface p-2 shadow-xl">
            <p className="px-1 pb-1 text-xs text-faint">Sleep timer</p>
            {sleepActive && (
              <button
                onClick={() => {
                  setSleep(null);
                  setSleepOpen(false);
                }}
                className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-red-400 hover:bg-surface2"
              >
                Turn off{sleepBadge ? ` · ${sleepBadge} left` : ''}
              </button>
            )}

            <p className="px-1 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-faint">
              After chapters
            </p>
            <div className="grid grid-cols-5 gap-1">
              {SLEEP_PRESETS_CH.map((c) => (
                <button
                  key={c}
                  onClick={() => startSleepChapters(c)}
                  className={cn(
                    'rounded-md py-1.5 text-sm hover:bg-surface2 hover:text-main',
                    sleep?.kind === 'chapters' && sleep.count === c
                      ? 'bg-surface2 text-accent'
                      : 'text-muted',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-1">
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={customCh}
                onChange={(e) => setCustomCh(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') startSleepChapters(Number(customCh));
                }}
                placeholder="Custom chapters"
                aria-label="Custom chapter count"
                className="w-full min-w-0 rounded-md border border-edge bg-app px-2 py-1 text-sm text-main outline-none focus:border-accent"
              />
              <button
                onClick={() => startSleepChapters(Number(customCh))}
                disabled={Math.floor(Number(customCh)) < 1}
                className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent-hov disabled:opacity-40"
              >
                Set
              </button>
            </div>

            <p className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint">
              After minutes
            </p>
            <div className="grid grid-cols-3 gap-1">
              {SLEEP_PRESETS_MIN.map((m) => (
                <button
                  key={m}
                  onClick={() => startSleepMinutes(m)}
                  className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface2 hover:text-main"
                >
                  {m}m
                </button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-1 border-t border-edge pt-2">
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') startSleepMinutes(Number(customMin));
                }}
                placeholder="Custom min"
                aria-label="Custom minutes"
                className="w-full min-w-0 rounded-md border border-edge bg-app px-2 py-1 text-sm text-main outline-none focus:border-accent"
              />
              <button
                onClick={() => startSleepMinutes(Number(customMin))}
                disabled={Math.floor(Number(customMin)) < 1}
                className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent-hov disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Center: transport — absolutely centered regardless of the side buttons */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4">
        <button
          onClick={() => onSkip(-1)}
          aria-label="Previous paragraph"
          className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main"
        >
          <SkipBack className="h-5 w-5" />
        </button>
        <button
          onClick={status === 'playing' ? onPause : onResume}
          aria-label={status === 'playing' ? 'Pause' : 'Resume'}
          className="rounded-full bg-accent p-2.5 text-on-accent transition-colors hover:bg-accent-hov"
        >
          {status === 'playing' ? (
            <Pause className="h-5 w-5" />
          ) : (
            // translate compensates the triangle's optical left bias
            <Play className="h-5 w-5 translate-x-[1.5px]" />
          )}
        </button>
        <button
          onClick={() => onSkip(1)}
          aria-label="Next paragraph"
          className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-main"
        >
          <SkipForward className="h-5 w-5" />
        </button>
      </div>

      {/* Right: stop */}
      <button
        onClick={onStop}
        aria-label="Stop listening"
        className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-red-400"
      >
        <Square className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------- voice / rate / pitch UI ------------------------ */

interface TTSVoiceSettingsProps {
  /** Called after a setting changes so the engine can re-speak immediately. */
  onChanged: () => void;
}

export function TTSVoiceSettings({ onChanged }: TTSVoiceSettingsProps) {
  const rate = useTtsStore((s) => s.rate);
  const pitch = useTtsStore((s) => s.pitch);
  const volume = useTtsStore((s) => s.volume);
  const voiceURI = useTtsStore((s) => s.voiceURI);
  const setRate = useTtsStore((s) => s.setRate);
  const setPitch = useTtsStore((s) => s.setPitch);
  const setVolume = useTtsStore((s) => s.setVolume);
  const setVoiceURI = useTtsStore((s) => s.setVoiceURI);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = (): void => setVoices(window.speechSynthesis.getVoices());
    load(); // Chrome populates async; Safari/Firefox synchronously
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  return (
    <div className="flex flex-col gap-3 border-t border-edge pt-3">
      <p className="text-xs font-medium text-muted">Listening</p>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Voice
        <select
          value={voiceURI ?? ''}
          onChange={(e) => {
            setVoiceURI(e.target.value || null);
            onChanged();
          }}
          className="rounded-md border border-edge bg-app px-2 py-1.5 text-sm text-main outline-none focus:border-accent"
        >
          <option value="">System default</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">
          Speed <span className="text-main">{rate.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min={TTS_MIN_RATE}
          max={TTS_MAX_RATE}
          step={0.05}
          value={Math.min(rate, TTS_MAX_RATE)}
          onChange={(e) => setRate(Number(e.target.value))}
          onPointerUp={onChanged}
          className="accent-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">
          Pitch <span className="text-main">{pitch.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={TTS_MIN_PITCH}
          max={TTS_MAX_PITCH}
          step={0.05}
          value={Math.min(pitch, TTS_MAX_PITCH)}
          onChange={(e) => setPitch(Number(e.target.value))}
          onPointerUp={onChanged}
          className="accent-accent"
        />
      </label>
      {IS_DESKTOP && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex justify-between">
            Volume <span className="text-main">{Math.round(volume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={onChanged}
            className="accent-accent"
          />
        </label>
      )}
    </div>
  );
}
