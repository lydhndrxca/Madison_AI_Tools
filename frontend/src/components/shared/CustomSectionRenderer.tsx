import { useCallback, useRef } from "react";
import { ImagePlus, X, ClipboardPaste } from "lucide-react";
import { readClipboardImage } from "@/hooks/useClipboardPaste";
import type { CustomSectionDef, CustomBlockDef } from "@/hooks/CustomSectionsContext";

interface CustomSectionRendererProps {
  section: CustomSectionDef;
  values: Record<string, unknown>;
  onChange: (blockId: string, value: unknown) => void;
  disabled?: boolean;
}

function TextBlock({ block, value, onChange, disabled }: BlockProps) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        {block.label}
      </label>
      <input
        type="text"
        value={(value as string) ?? (block.defaultValue as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={block.placeholder}
        disabled={disabled}
        className="w-full text-xs px-2 py-1 rounded"
        style={{
          background: "var(--color-input-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
        }}
      />
    </div>
  );
}

function TextAreaBlock({ block, value, onChange, disabled }: BlockProps) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        {block.label}
      </label>
      <textarea
        rows={3}
        value={(value as string) ?? (block.defaultValue as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={block.placeholder}
        disabled={disabled}
        className="w-full text-xs px-2 py-1 rounded resize-y"
        style={{
          background: "var(--color-input-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
        }}
      />
    </div>
  );
}

function DropdownBlock({ block, value, onChange, disabled }: BlockProps) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        {block.label}
      </label>
      <select
        value={(value as string) ?? (block.defaultValue as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full text-xs px-2 py-1 rounded"
        style={{
          background: "var(--color-input-bg)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
        }}
      >
        <option value="">— Select —</option>
        {(block.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleBlock({ block, value, onChange, disabled }: BlockProps) {
  const isOn = value === true || (value === undefined && block.defaultValue === true);
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(!isOn)}
        disabled={disabled}
        className="w-7 h-4 rounded-full relative cursor-pointer transition-colors"
        style={{
          background: isOn ? "var(--color-accent)" : "var(--color-border)",
        }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full transition-transform"
          style={{
            background: "white",
            left: isOn ? 14 : 2,
          }}
        />
      </button>
      <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
        {block.label}
      </span>
    </div>
  );
}

function TagsBlock({ block, value, onChange, disabled }: BlockProps) {
  const selected = (value as string[]) ?? (block.defaultValue as string[]) ?? [];
  const presets = block.presets ?? [];
  const customInputRef = useRef<HTMLInputElement>(null);

  const toggleTag = useCallback((tag: string) => {
    const next = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
    onChange(next);
  }, [selected, onChange]);

  const addCustom = useCallback(() => {
    const v = customInputRef.current?.value.trim();
    if (v && !selected.includes(v)) { onChange([...selected, v]); }
    if (customInputRef.current) customInputRef.current.value = "";
  }, [selected, onChange]);

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        {block.label}
      </label>
      <div className="flex flex-wrap gap-1">
        {presets.map((tag) => (
          <button
            key={tag}
            onClick={() => !disabled && toggleTag(tag)}
            disabled={disabled}
            className="px-1.5 py-0.5 text-[10px] rounded-full cursor-pointer"
            style={{
              background: selected.includes(tag) ? "var(--color-accent)" : "var(--color-input-bg)",
              color: selected.includes(tag) ? "white" : "var(--color-text-secondary)",
              border: "1px solid " + (selected.includes(tag) ? "var(--color-accent)" : "var(--color-border)"),
            }}
          >
            {tag}
          </button>
        ))}
        {selected.filter((t) => !presets.includes(t)).map((tag) => (
          <button
            key={tag}
            onClick={() => !disabled && toggleTag(tag)}
            disabled={disabled}
            className="px-1.5 py-0.5 text-[10px] rounded-full cursor-pointer"
            style={{ background: "var(--color-accent)", color: "white", border: "1px solid var(--color-accent)" }}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          ref={customInputRef}
          type="text"
          placeholder="Add tag..."
          disabled={disabled}
          className="flex-1 text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
        />
        <button
          onClick={addCustom}
          disabled={disabled}
          className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
        >
          +
        </button>
      </div>
    </div>
  );
}

function ImageBlock({ block, value, onChange, disabled }: BlockProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const images = ((value as string[]) ?? []).filter(Boolean);
  const max = block.maxImages ?? 1;

  const addImage = useCallback((dataUrl: string) => {
    if (images.length >= max) return;
    onChange([...images, dataUrl]);
  }, [images, max, onChange]);

  const removeImage = useCallback((idx: number) => {
    onChange(images.filter((_, i) => i !== idx));
  }, [images, onChange]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") addImage(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [addImage]);

  const handlePaste = useCallback(async () => {
    const img = await readClipboardImage();
    if (img) addImage(img);
  }, [addImage]);

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        {block.label} {images.length > 0 && `(${images.length}/${max})`}
      </label>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {images.length < max && (
        <div className="flex gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            <ImagePlus className="h-3 w-3" /> Open
          </button>
          <button
            onClick={handlePaste}
            disabled={disabled}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded cursor-pointer"
            style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            <ClipboardPaste className="h-3 w-3" /> Paste
          </button>
        </div>
      )}
      {images.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {images.map((img, i) => (
            <div key={i} className="relative w-14 h-14 rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              <img src={img} className="w-full h-full object-cover" />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-0 right-0 p-0.5 cursor-pointer"
                style={{ background: "rgba(0,0,0,0.6)" }}
              >
                <X className="h-2.5 w-2.5 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SliderBlock({ block, value, onChange, disabled }: BlockProps) {
  const min = block.min ?? 0;
  const max = block.max ?? 100;
  const step = block.step ?? 1;
  const numVal = (value as number) ?? (block.defaultValue as number) ?? min;
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
          {block.label}
        </label>
        <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
          {numVal}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={numVal}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full h-1 rounded-lg appearance-none cursor-pointer"
        style={{ accentColor: "var(--color-accent)" }}
      />
    </div>
  );
}

function ColorBlock({ block, value, onChange, disabled }: BlockProps) {
  const colorVal = (value as string) ?? (block.defaultValue as string) ?? "#808080";
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>
        {block.label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={colorVal}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-6 h-6 rounded cursor-pointer border-0 p-0"
        />
        <span className="text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>
          {colorVal}
        </span>
      </div>
    </div>
  );
}

/* ── Block props ──────────────────────────────────────────────── */

interface BlockProps {
  block: CustomBlockDef;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

const BLOCK_RENDERERS: Record<string, React.FC<BlockProps>> = {
  text: TextBlock,
  textarea: TextAreaBlock,
  dropdown: DropdownBlock,
  toggle: ToggleBlock,
  tags: TagsBlock,
  image: ImageBlock,
  slider: SliderBlock,
  color: ColorBlock,
};

/* ── Main renderer ────────────────────────────────────────────── */

export function CustomSectionRenderer({ section, values, onChange, disabled = false }: CustomSectionRendererProps) {
  return (
    <div className="space-y-2.5">
      {section.blocks.map((block) => {
        const Renderer = BLOCK_RENDERERS[block.type];
        if (!Renderer) return null;
        return (
          <Renderer
            key={block.id}
            block={block}
            value={values[block.id]}
            onChange={(val) => onChange(block.id, val)}
            disabled={disabled}
          />
        );
      })}
      {section.blocks.length === 0 && (
        <p className="text-[10px] italic" style={{ color: "var(--color-text-muted)" }}>
          No blocks configured. Open the Prompt Builder to add blocks.
        </p>
      )}
    </div>
  );
}
