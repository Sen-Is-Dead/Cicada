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

const SLEEP_PRESETS_MIN = [5, 10, 15, 20, 30, 45, 60];

interface TTSControlsProps {
  onListen: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: (delta: number) => void;
}

export function TTSControls({ onListen, onPause, onResume, onStop, onSkip }: TTSControlsProps) {
  const status = useTtsStore((s) => s.status);

  /* Sleep timer (whole minutes only) — pauses playback when it expires */
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [, setTick] = useState(0); // refresh the remaining-minutes label

  useEffect(() => {
    if (sleepUntil === null) return;
    const id = window.setInterval(() => {
      if (Date.now() >= sleepUntil) {
        setSleepUntil(null);
        onPause(); // no-op unless playing
      } else {
        setTick((t) => t + 1);
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [sleepUntil, onPause]);

  // Ending the session clears the timer
  useEffect(() => {
    if (status === 'idle') {
      setSleepUntil(null);
      setSleepOpen(false);
    }
  }, [status]);

  const startSleep = (minutes: number): void => {
    const whole = Math.floor(minutes);
    if (!Number.isFinite(whole) || whole < 1) return;
    setSleepUntil(Date.now() + whole * 60_000);
    setSleepOpen(false);
    setCustomMin('');
  };

  const remainingMin =
    sleepUntil !== null ? Math.max(1, Math.ceil((sleepUntil - Date.now()) / 60_000)) : null;

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
            remainingMin !== null ? 'text-accent' : 'text-muted hover:text-main',
          )}
        >
          <Timer className="h-5 w-5" />
          {remainingMin !== null && <span className="font-medium">{remainingMin}m</span>}
        </button>

        {sleepOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-44 rounded-xl border border-edge bg-surface p-2 shadow-xl">
            <p className="px-1 pb-1 text-xs text-faint">Sleep timer</p>
            {remainingMin !== null && (
              <button
                onClick={() => {
                  setSleepUntil(null);
                  setSleepOpen(false);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-red-400 hover:bg-surface2"
              >
                Turn off
              </button>
            )}
            <div className="grid grid-cols-2 gap-1">
              {SLEEP_PRESETS_MIN.map((m) => (
                <button
                  key={m}
                  onClick={() => startSleep(m)}
                  className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface2 hover:text-main"
                >
                  {m} min
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
                  if (e.key === 'Enter') startSleep(Number(customMin));
                }}
                placeholder="Custom"
                aria-label="Custom minutes"
                className="w-full min-w-0 rounded-md border border-edge bg-app px-2 py-1 text-sm text-main outline-none focus:border-accent"
              />
              <button
                onClick={() => startSleep(Number(customMin))}
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
  const voiceURI = useTtsStore((s) => s.voiceURI);
  const setRate = useTtsStore((s) => s.setRate);
  const setPitch = useTtsStore((s) => s.setPitch);
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
    </div>
  );
}
