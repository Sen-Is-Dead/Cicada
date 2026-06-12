import { useReaderStore } from '../../store/readerStore';

export function TypographySliders() {
  const fontSize = useReaderStore((s) => s.fontSize);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const setFontSize = useReaderStore((s) => s.setFontSize);
  const setLineHeight = useReaderStore((s) => s.setLineHeight);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">
          Font size <span className="text-muted">{fontSize}px</span>
        </span>
        <input
          type="range"
          min={14}
          max={28}
          step={1}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="accent-accent"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <span className="flex justify-between">
          Line height <span className="text-muted">{lineHeight.toFixed(1)}</span>
        </span>
        <input
          type="range"
          min={1.2}
          max={2.2}
          step={0.1}
          value={lineHeight}
          onChange={(e) => setLineHeight(Number(e.target.value))}
          className="accent-accent"
        />
      </label>
    </div>
  );
}
