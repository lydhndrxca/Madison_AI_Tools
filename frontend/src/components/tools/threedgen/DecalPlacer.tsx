import { useCallback, useRef, useState } from "react";
import { Sticker, Upload, X, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { projectDecal } from "@/lib/workshopApi";

export interface DecalPlacerProps {
  projectId: string | null;
  versionId?: string;
  onVersionCreated?: () => void;
}

export function DecalPlacer({ projectId, versionId, onVersionCreated }: DecalPlacerProps) {
  const [decalB64, setDecalB64] = useState<string | null>(null);
  const [decalPreview, setDecalPreview] = useState<string | null>(null);
  const [scale, setScale] = useState(0.5);
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [normal, setNormal] = useState<[number, number, number]>([0, 1, 0]);
  const [hasPlacement, setHasPlacement] = useState(false);
  const [baking, setBaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDecalPreview(reader.result);
        setDecalB64(reader.result.split(",")[1]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleBake = useCallback(async () => {
    if (!projectId || !decalB64) return;
    setBaking(true);
    setError(null);
    try {
      await projectDecal(projectId, decalB64, position, normal, scale, 1.0, versionId);
      onVersionCreated?.();
      setHasPlacement(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Decal projection failed");
    } finally {
      setBaking(false);
    }
  }, [projectId, decalB64, position, normal, scale, versionId, onVersionCreated]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Sticker className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          Decal Projection
        </span>
      </div>

      <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
        Upload a decal image, then click on the 3D model to place it.
      </div>

      {/* Decal image upload */}
      {decalPreview ? (
        <div className="relative inline-block">
          <img
            src={decalPreview}
            alt="Decal"
            className="h-16 w-16 rounded object-contain"
            style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}
          />
          <button
            type="button"
            onClick={() => { setDecalB64(null); setDecalPreview(null); setHasPlacement(false); }}
            className="absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
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
          }}
        >
          <Upload className="h-3 w-3" /> Upload Decal Image
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />

      {/* Scale control */}
      {decalB64 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ZoomOut className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
            <input
              type="range"
              min={0.05}
              max={2.0}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="flex-1 accent-purple-500"
            />
            <ZoomIn className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
            <span className="text-[9px] w-8 text-right" style={{ color: "var(--color-text-secondary)" }}>
              {scale.toFixed(2)}
            </span>
          </div>

          {/* Position inputs */}
          <div className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Position:</span>
            {["X", "Y", "Z"].map((axis, i) => (
              <div key={axis} className="flex items-center gap-0.5">
                <span className="text-[8px]" style={{ color: "var(--color-text-muted)" }}>{axis}</span>
                <input
                  type="number"
                  step={0.1}
                  value={position[i]}
                  onChange={(e) => {
                    const newPos = [...position] as [number, number, number];
                    newPos[i] = Number(e.target.value);
                    setPosition(newPos);
                    setHasPlacement(true);
                  }}
                  className="w-12 px-1 py-0.5 rounded text-[9px] text-center"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
            ))}
          </div>

          {/* Normal inputs */}
          <div className="flex items-center gap-1">
            <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Normal:</span>
            {["X", "Y", "Z"].map((axis, i) => (
              <div key={axis} className="flex items-center gap-0.5">
                <span className="text-[8px]" style={{ color: "var(--color-text-muted)" }}>{axis}</span>
                <input
                  type="number"
                  step={0.1}
                  value={normal[i]}
                  onChange={(e) => {
                    const newNorm = [...normal] as [number, number, number];
                    newNorm[i] = Number(e.target.value);
                    setNormal(newNorm);
                    setHasPlacement(true);
                  }}
                  className="w-12 px-1 py-0.5 rounded text-[9px] text-center"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>
            ))}
          </div>

          <div
            className="text-[9px] px-2 py-1 rounded"
            style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa" }}
          >
            Tip: Click on the model in the 3D viewport to auto-fill position and normal.
          </div>

          {/* Bake button */}
          <button
            type="button"
            onClick={handleBake}
            disabled={!projectId || baking || !decalB64}
            className="w-full py-1.5 rounded text-[10px] font-semibold"
            style={{
              background: projectId && !baking ? "rgba(139,92,246,0.7)" : "rgba(255,255,255,0.06)",
              color: projectId && !baking ? "#fff" : "var(--color-text-muted)",
              border: "none",
              cursor: projectId && !baking ? "pointer" : "default",
            }}
          >
            {baking ? (
              <><Loader2 className="h-3 w-3 inline-block animate-spin mr-1" style={{ verticalAlign: "text-bottom" }} />Baking...</>
            ) : (
              "Bake Decal"
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="text-[9px] px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
          {error}
        </div>
      )}
    </div>
  );
}
