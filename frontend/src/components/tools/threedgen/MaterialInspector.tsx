import { useMemo } from "react";
import { Layers, Box, CircleDot, Image as ImageIcon } from "lucide-react";
import type { MaterialSlotInfo, TargetingModel } from "@/lib/workshopTypes";

export interface MaterialInspectorProps {
  slots: MaterialSlotInfo[];
  targeting: TargetingModel;
  onSelectSlot: (index: number) => void;
  onSelectAll: () => void;
}

function TexBadge({ label, info }: { label: string; info?: { width: number; height: number } }) {
  if (!info) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5"
      style={{
        fontSize: 9,
        fontWeight: 500,
        background: "rgba(255,255,255,0.06)",
        color: "var(--color-text-secondary)",
      }}
    >
      <ImageIcon className="h-2.5 w-2.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
      {label} {info.width}x{info.height}
    </span>
  );
}

export function MaterialInspector({ slots, targeting, onSelectSlot, onSelectAll }: MaterialInspectorProps) {
  const isFullObject = targeting.scope === "full-object";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div
        className="shrink-0 px-3 py-2 flex items-center gap-2"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <Layers className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-[11px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Materials
        </span>
        <span className="text-[10px] ml-auto" style={{ color: "var(--color-text-muted)" }}>
          {slots.length} slot{slots.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Select All button */}
      <button
        type="button"
        onClick={onSelectAll}
        className="shrink-0 mx-2 mt-2 mb-1 px-2 py-1.5 rounded text-left"
        style={{
          fontSize: 10,
          fontWeight: 600,
          border: `1px solid ${isFullObject ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.08)"}`,
          background: isFullObject ? "rgba(139,92,246,0.1)" : "transparent",
          color: "var(--color-text-primary)",
        }}
      >
        <Box className="h-3 w-3 mr-1 inline-block" style={{ verticalAlign: "text-bottom" }} />
        Select All — Full Object
      </button>

      {/* Slot list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 pt-1 pb-2 space-y-1.5">
        {slots.length === 0 && (
          <div className="text-center text-[10px] py-4" style={{ color: "var(--color-text-muted)" }}>
            No materials found
          </div>
        )}
        {slots.map((slot) => {
          const isSelected = targeting.scope === "material-slot" && targeting.materialSlotIndex === slot.index;
          const hasTex = slot.textures.baseColor || slot.textures.normal || slot.textures.roughness || slot.textures.metallic;

          return (
            <button
              key={slot.index}
              type="button"
              onClick={() => onSelectSlot(slot.index)}
              className="w-full text-left rounded-md px-2.5 py-2 transition-colors"
              style={{
                border: `1px solid ${isSelected ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.06)"}`,
                background: isSelected ? "rgba(139,92,246,0.08)" : "rgba(255,255,255,0.02)",
              }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <CircleDot
                  className="h-3 w-3 shrink-0"
                  style={{ color: isSelected ? "#8b5cf6" : "var(--color-text-muted)" }}
                />
                <span
                  className="text-[10px] font-semibold truncate"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {slot.name}
                </span>
              </div>

              <div className="flex items-center gap-1.5 ml-4.5 text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                <span>
                  {slot.meshNames.length} mesh{slot.meshNames.length !== 1 ? "es" : ""}
                </span>
                <span>•</span>
                <span>{slot.hasUVs ? "Has UVs" : "No UVs"}</span>
              </div>

              {hasTex && (
                <div className="flex flex-wrap gap-1 mt-1.5 ml-4.5">
                  <TexBadge label="Color" info={slot.textures.baseColor} />
                  <TexBadge label="Norm" info={slot.textures.normal} />
                  <TexBadge label="Rough" info={slot.textures.roughness} />
                  <TexBadge label="Metal" info={slot.textures.metallic} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
