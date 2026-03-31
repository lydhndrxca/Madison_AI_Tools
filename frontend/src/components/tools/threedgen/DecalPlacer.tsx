import { useCallback, useRef, useState } from "react";
import { Sticker, Upload, X, Loader2, ZoomIn, ZoomOut, Eye, EyeOff, Crosshair, Trash2 } from "lucide-react";
import { projectDecal } from "@/lib/workshopApi";
import type { DecalState } from "@/lib/workshopTypes";

export interface DecalPlacerProps {
  projectId: string | null;
  versionId?: string;
  onVersionCreated?: () => void;
  decalState?: DecalState | null;
  onDecalStateChange?: (state: DecalState | null) => void;
  modelCenterOffset?: [number, number, number];
}

export function DecalPlacer({
  projectId,
  versionId,
  onVersionCreated,
  decalState,
  onDecalStateChange,
  modelCenterOffset = [0, 0, 0],
}: DecalPlacerProps) {
  const [baking, setBaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasImage = !!decalState?.imageUrl;
  const hasPlacement = hasImage && decalState!.position.some((v) => v !== 0);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onDecalStateChange) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onDecalStateChange({
            imageUrl: reader.result,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: 0.5,
            opacity: 0.85,
          });
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [onDecalStateChange],
  );

  const handleClear = useCallback(() => {
    onDecalStateChange?.(null);
    setError(null);
  }, [onDecalStateChange]);

  const handleBake = useCallback(async () => {
    if (!projectId || !decalState?.imageUrl || !hasPlacement) return;
    setBaking(true);
    setError(null);
    try {
      const decalB64 = decalState.imageUrl.includes(",")
        ? decalState.imageUrl.split(",")[1]
        : decalState.imageUrl;

      const normal: [number, number, number] = [
        -Math.sin(decalState.rotation[1]) * Math.cos(decalState.rotation[0]),
        Math.sin(decalState.rotation[0]),
        -Math.cos(decalState.rotation[1]) * Math.cos(decalState.rotation[0]),
      ];

      // Add back the center offset so the position matches the original GLB coordinates
      const bakePosition: [number, number, number] = [
        decalState.position[0] + modelCenterOffset[0],
        decalState.position[1] + modelCenterOffset[1],
        decalState.position[2] + modelCenterOffset[2],
      ];

      await projectDecal(
        projectId,
        decalB64,
        bakePosition,
        normal,
        decalState.scale,
        decalState.opacity,
        versionId,
      );
      onVersionCreated?.();
      onDecalStateChange?.(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Decal projection failed");
    } finally {
      setBaking(false);
    }
  }, [projectId, decalState, hasPlacement, versionId, onVersionCreated, onDecalStateChange, modelCenterOffset]);

  const fmtNum = (n: number) => n.toFixed(3);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Sticker className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
        <span
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--color-text-muted)" }}
        >
          Decal Projection
        </span>
      </div>

      <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
        Upload a decal image, then click on the 3D model to place it. Use the gizmo to
        adjust position, rotation, and scale (T / R / S keys).
      </div>

      {/* Decal image upload / preview */}
      {hasImage ? (
        <div className="relative inline-block">
          <img
            src={decalState!.imageUrl}
            alt="Decal"
            className="h-16 w-16 rounded object-contain"
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.03)",
            }}
          />
          <button
            type="button"
            onClick={handleClear}
            className="absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
            title="Remove decal"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px]"
          style={{
            border: "1px dashed rgba(255,255,255,0.15)",
            color: "var(--color-text-secondary)",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <Upload className="h-3 w-3" /> Upload Decal Image
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Controls — only visible when an image is loaded */}
      {hasImage && (
        <div className="space-y-2">
          {/* Placement hint */}
          {!hasPlacement && (
            <div
              className="text-[9px] px-2 py-1.5 rounded flex items-center gap-1.5"
              style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa" }}
            >
              <Crosshair className="h-3 w-3 shrink-0" />
              Click on the model to place the decal.
            </div>
          )}

          {/* Scale slider */}
          <div className="space-y-0.5">
            <label className="text-[9px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              Scale
            </label>
            <div className="flex items-center gap-2">
              <ZoomOut className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <input
                type="range"
                min={0.02}
                max={3.0}
                step={0.02}
                value={decalState!.scale}
                onChange={(e) =>
                  onDecalStateChange?.({ ...decalState!, scale: Number(e.target.value) })
                }
                className="flex-1 accent-purple-500"
              />
              <ZoomIn className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <span
                className="text-[9px] w-8 text-right tabular-nums"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {decalState!.scale.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Opacity slider */}
          <div className="space-y-0.5">
            <label className="text-[9px] font-medium" style={{ color: "var(--color-text-muted)" }}>
              Opacity
            </label>
            <div className="flex items-center gap-2">
              <EyeOff className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <input
                type="range"
                min={0.05}
                max={1.0}
                step={0.05}
                value={decalState!.opacity}
                onChange={(e) =>
                  onDecalStateChange?.({ ...decalState!, opacity: Number(e.target.value) })
                }
                className="flex-1 accent-purple-500"
              />
              <Eye className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <span
                className="text-[9px] w-8 text-right tabular-nums"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {(decalState!.opacity * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Position / Rotation readout */}
          {hasPlacement && (
            <div
              className="text-[8px] px-2 py-1.5 rounded space-y-0.5 tabular-nums"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "var(--color-text-muted)",
              }}
            >
              <div>
                <span className="font-semibold">Pos</span>&nbsp;
                X {fmtNum(decalState!.position[0])}&ensp;
                Y {fmtNum(decalState!.position[1])}&ensp;
                Z {fmtNum(decalState!.position[2])}
              </div>
              <div>
                <span className="font-semibold">Rot</span>&nbsp;
                X {fmtNum(decalState!.rotation[0])}&ensp;
                Y {fmtNum(decalState!.rotation[1])}&ensp;
                Z {fmtNum(decalState!.rotation[2])}
              </div>
            </div>
          )}

          {/* Gizmo mode hint */}
          {hasPlacement && (
            <div
              className="text-[8px] px-2 py-1 rounded"
              style={{ background: "rgba(255,255,255,0.03)", color: "var(--color-text-muted)" }}
            >
              Gizmo: <strong>W</strong> move &middot; <strong>E</strong> rotate &middot;{" "}
              <strong>R</strong> scale
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleClear}
              className="flex-1 py-1.5 rounded text-[10px] font-semibold flex items-center justify-center gap-1"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--color-text-secondary)",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
              }}
            >
              <Trash2 className="h-3 w-3" /> Cancel
            </button>
            <button
              type="button"
              onClick={handleBake}
              disabled={!projectId || baking || !hasPlacement}
              className="flex-1 py-1.5 rounded text-[10px] font-semibold"
              style={{
                background:
                  projectId && !baking && hasPlacement
                    ? "rgba(139,92,246,0.7)"
                    : "rgba(255,255,255,0.06)",
                color:
                  projectId && !baking && hasPlacement ? "#fff" : "var(--color-text-muted)",
                border: "none",
                cursor: projectId && !baking && hasPlacement ? "pointer" : "default",
              }}
            >
              {baking ? (
                <>
                  <Loader2
                    className="h-3 w-3 inline-block animate-spin mr-1"
                    style={{ verticalAlign: "text-bottom" }}
                  />
                  Baking...
                </>
              ) : (
                "Bake Decal"
              )}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          className="text-[9px] px-2 py-1 rounded"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
