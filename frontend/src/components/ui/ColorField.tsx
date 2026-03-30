import { useRef } from "react";

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

declare global {
  interface EyeDropper { open(): Promise<{ sRGBHex: string }>; }
  interface EyeDropperConstructor { new(): EyeDropper; }
  interface Window { EyeDropper?: EyeDropperConstructor; }
}

const inputStyle: React.CSSProperties = {
  background: "var(--color-input-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-primary)",
};

function isValidColor(str: string): string | null {
  if (!str.trim()) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(str)) return str;
  const el = document.createElement("div");
  el.style.color = str;
  if (el.style.color) return str;
  return null;
}

export function ColorField({ label, value, onChange, placeholder, disabled = false }: ColorFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const resolved = isValidColor(value);

  const handleEyedropper = async () => {
    if (!window.EyeDropper) return;
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      onChange(result.sRGBHex);
    } catch { /* user cancelled */ }
  };

  return (
    <div>
      <span className="text-xs block mb-0.5" style={{ color: "var(--color-text-secondary)" }}>{label}</span>
      <div className="flex items-center gap-1">
        <input
          className="flex-1 px-2 py-1 text-xs min-w-0"
          style={inputStyle}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
        {/* Color swatch — click opens native color picker */}
        <button
          type="button"
          disabled={disabled}
          className="w-6 h-6 rounded-[var(--radius-sm)] shrink-0 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
          style={{
            background: resolved || "#333",
            border: "1px solid var(--color-border)",
            opacity: (resolved && !disabled) ? 1 : 0.4,
          }}
          title="Open color picker"
          onClick={() => pickerRef.current?.click()}
        />
        <input
          ref={pickerRef}
          type="color"
          className="sr-only"
          value={resolved && /^#[0-9a-f]{6}$/i.test(value) ? value : "#808080"}
          onChange={(e) => onChange(e.target.value)}
        />
        {/* Eyedropper */}
        {window.EyeDropper && (
          <button
            type="button"
            disabled={disabled}
            className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] shrink-0 cursor-pointer text-[12px] disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
            title="Eyedropper — pick color from screen"
            onClick={handleEyedropper}
          >
            &#x1F4A7;
          </button>
        )}
      </div>
    </div>
  );
}
