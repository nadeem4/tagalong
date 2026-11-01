/**
 * Slider: a native range input (arrows, Home, End and PageUp/Down come free) with its label
 * above and the current value beside it, so the value is readable without dragging.
 */
export function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = String,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(n: number): void;
  format?: (n: number) => string;
}) {
  return (
    <div className="tg-slider">
      <div className="tg-slider__head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
