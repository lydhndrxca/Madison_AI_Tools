import { useCallback, useRef } from "react";
import { ImagePlus, X, ClipboardPaste } from "lucide-react";
import { readClipboardImage } from "@/hooks/useClipboardPaste";

export interface FusionSlot {
  label: string;
  takeFrom: string;
  image?: string | null;
}

export interface StyleFusionState {
  slots: [FusionSlot, FusionSlot];
  blend: number;
}

export const EMPTY_FUSION: StyleFusionState = {
  slots: [
    { label: "", takeFrom: "overall vibe", image: null },
    { label: "", takeFrom: "overall vibe", image: null },
  ],
  blend: 50,
};

export function buildFusionBrief(fusion: StyleFusionState): string {
  const [s1, s2] = fusion.slots;
  const has1 = !!s1.label.trim() || !!s1.image;
  const has2 = !!s2.label.trim() || !!s2.image;
  if (!has1 && !has2) return "";
  const w1 = 100 - fusion.blend;
  const w2 = fusion.blend;
  if (has1 && has2) {
    const lbl1 = s1.label.trim() || (s1.image ? "[uploaded image]" : "Ref 1");
    const lbl2 = s2.label.trim() || (s2.image ? "[uploaded image]" : "Ref 2");
    return [
      `Style blend: "${lbl1}" (${w1}%) + "${lbl2}" (${w2}%)`,
      `  From "${lbl1}": ${s1.takeFrom}`,
      `  From "${lbl2}": ${s2.takeFrom}`,
    ].join("\n");
  }
  const slot = has1 ? s1 : s2;
  const lbl = slot.label.trim() || (slot.image ? "[uploaded image]" : "Ref");
  return `Style: "${lbl}" — ${slot.takeFrom}`;
}

const inputStyle = {
  background: "var(--color-input-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--color-text-primary)",
};

const imgBtnStyle: React.CSSProperties = {
  background: "var(--color-input-bg)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 6px",
  fontSize: 10,
};

interface StyleFusionPanelProps {
  fusion: StyleFusionState;
  onChange: (next: StyleFusionState) => void;
  takeOptions: string[];
  disabled?: boolean;
  placeholder1?: string;
  placeholder2?: string;
}

function SlotImageRow({
  image,
  disabled,
  onSetImage,
  onClearImage,
}: {
  image?: string | null;
  disabled?: boolean;
  onSetImage: (dataUrl: string) => void;
  onClearImage: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") onSetImage(reader.result);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [onSetImage],
  );

  const handlePaste = useCallback(async () => {
    try {
      const dataUrl = await readClipboardImage();
      if (dataUrl) onSetImage(dataUrl);
    } catch { /* */ }
  }, [onSetImage]);

  if (image) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <img
          src={image}
          alt="ref"
          className="rounded"
          style={{
            width: 40,
            height: 40,
            objectFit: "cover",
            border: "1px solid var(--color-border)",
          }}
        />
        <span className="text-[9px] flex-1" style={{ color: "var(--color-text-muted)" }}>
          Reference image attached
        </span>
        <button
          onClick={onClearImage}
          disabled={disabled}
          style={{ ...imgBtnStyle, color: "#e55" }}
          title="Remove image"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        style={imgBtnStyle}
        title="Open an image file as style reference"
      >
        <ImagePlus className="h-3 w-3" /> Open
      </button>
      <button
        onClick={handlePaste}
        disabled={disabled}
        style={imgBtnStyle}
        title="Paste image from clipboard"
      >
        <ClipboardPaste className="h-3 w-3" /> Paste
      </button>
    </div>
  );
}

export function StyleFusionPanel({
  fusion,
  onChange,
  takeOptions,
  disabled = false,
  placeholder1 = 'Name a style, e.g. "military chic", "gothic royalty"',
  placeholder2 = 'Name a second style, e.g. "frontier survivalist"',
}: StyleFusionPanelProps) {
  const updateSlot = useCallback(
    (idx: 0 | 1, patch: Partial<FusionSlot>) => {
      onChange({
        ...fusion,
        slots: fusion.slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)) as [FusionSlot, FusionSlot],
      });
    },
    [fusion, onChange],
  );

  return (
    <div className="space-y-3">
      {/* Reference 1 */}
      <div
        className="rounded p-2 space-y-1.5"
        style={{ border: "1px solid var(--color-border)", background: "rgba(106,27,154,0.06)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
            Reference 1
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
            {100 - fusion.blend}%
          </span>
        </div>
        <input
          className="w-full px-2 py-1 text-xs"
          style={inputStyle}
          disabled={disabled}
          placeholder={placeholder1}
          value={fusion.slots[0].label}
          onChange={(e) => updateSlot(0, { label: e.target.value })}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-muted)" }}>Take</span>
          <select
            className="flex-1 px-1.5 py-0.5 text-[10px] rounded-[var(--radius-sm)]"
            style={inputStyle}
            disabled={disabled}
            value={fusion.slots[0].takeFrom}
            title="Choose which aspect of this style to borrow"
            onChange={(e) => updateSlot(0, { takeFrom: e.target.value })}
          >
            {takeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <SlotImageRow
          image={fusion.slots[0].image}
          disabled={disabled}
          onSetImage={(dataUrl) => updateSlot(0, { image: dataUrl })}
          onClearImage={() => updateSlot(0, { image: null })}
        />
      </div>

      {/* Blend slider */}
      <div className="rounded p-2 space-y-1" style={{ border: "1px solid var(--color-border)" }}>
        <div className="flex justify-between text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
          <span>
            {fusion.slots[0].label || "Ref 1"}{" "}
            <span className="tabular-nums">{100 - fusion.blend}%</span>
          </span>
          <span>
            <span className="tabular-nums">{fusion.blend}%</span>{" "}
            {fusion.slots[1].label || "Ref 2"}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={fusion.blend}
          className="w-full h-3"
          onChange={(e) => onChange({ ...fusion, blend: Number(e.target.value) })}
        />
        <p className="text-[9px] text-center" style={{ color: "var(--color-text-muted)" }}>
          Drag the slider to mix more of one style into the other
        </p>
      </div>

      {/* Reference 2 */}
      <div
        className="rounded p-2 space-y-1.5"
        style={{ border: "1px solid var(--color-border)", background: "rgba(106,27,154,0.06)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
            Reference 2
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
            {fusion.blend}%
          </span>
        </div>
        <input
          className="w-full px-2 py-1 text-xs"
          style={inputStyle}
          disabled={disabled}
          placeholder={placeholder2}
          value={fusion.slots[1].label}
          onChange={(e) => updateSlot(1, { label: e.target.value })}
        />
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-muted)" }}>Take</span>
          <select
            className="flex-1 px-1.5 py-0.5 text-[10px] rounded-[var(--radius-sm)]"
            style={inputStyle}
            disabled={disabled}
            value={fusion.slots[1].takeFrom}
            title="Choose which aspect of this style to borrow"
            onChange={(e) => updateSlot(1, { takeFrom: e.target.value })}
          >
            {takeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <SlotImageRow
          image={fusion.slots[1].image}
          disabled={disabled}
          onSetImage={(dataUrl) => updateSlot(1, { image: dataUrl })}
          onClearImage={() => updateSlot(1, { image: null })}
        />
      </div>
    </div>
  );
}
