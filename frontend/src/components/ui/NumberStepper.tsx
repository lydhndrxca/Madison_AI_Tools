import { Minus, Plus } from "lucide-react";

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** CSS width for the input field (default: auto-sized by max digits) */
  inputWidth?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 10,
  step = 1,
  label,
  inputWidth,
}: NumberStepperProps) {
  const autoWidth = inputWidth ?? `${Math.max(2.5, String(max).length * 0.65 + 1)}rem`;

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-xs shrink-0" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </span>
      )}
      <div
        className="inline-flex items-center rounded-[var(--radius-sm)]"
        style={{ border: "1px solid var(--color-border)" }}
      >
        <button
          className="px-1.5 py-0.5 text-xs cursor-pointer transition-colors hover:bg-[var(--color-hover)]"
          style={{ color: "var(--color-text-secondary)", background: "transparent", border: "none" }}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number"
          className="text-center text-xs py-0.5 tabular-nums"
          style={{
            width: autoWidth,
            background: "var(--color-input-bg)",
            color: "var(--color-text-primary)",
            border: "none",
            borderLeft: "1px solid var(--color-border)",
            borderRight: "1px solid var(--color-border)",
            MozAppearance: "textfield",
          }}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          onBlur={(e) => {
            if (e.target.value.trim() === "" || isNaN(parseInt(e.target.value, 10))) onChange(min);
          }}
        />
        <button
          className="px-1.5 py-0.5 text-xs cursor-pointer transition-colors hover:bg-[var(--color-hover)]"
          style={{ color: "var(--color-text-secondary)", background: "transparent", border: "none" }}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
