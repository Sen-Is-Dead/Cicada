import { useEffect, useState } from 'react';
import { Headphones, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react';
import {
  TTS_MAX_PITCH,
  TTS_MAX_RATE,
  TTS_MIN_PITCH,
  TTS_MIN_RATE,
  useTtsStore,
} from '../../store/ttsStore';

/* ------------------------------ playback bar ------------------------------ */

interface TTSControlsProps {
  onListen: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSkip: (delta: number) => void;
}

export function TTSControls({ onListen, onPause, onResume, onStop, onSkip }: TTSControlsProps) {
  const status = useTtsStore((s) => s.status);

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
    <div className="flex items-center justify-center gap-4 border-t border-edge bg-app/90 px-4 py-2 backdrop-blur">
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
