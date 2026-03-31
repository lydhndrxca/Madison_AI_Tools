import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Loader2,
  Paintbrush,
  Eraser,
  Square,
  Undo2,
  Download,
  Send,
} from "lucide-react";
import {
  renderUvAtlas,
  applyTexture,
  type UvAtlasResult,
} from "@/lib/workshopApi";
import { apiFetch } from "@/hooks/useApi";
import type { MaterialSlotInfo } from "@/lib/workshopTypes";

type Tool = "brush" | "eraser";

export interface UVAtlasEditorProps {
  projectId: string | null;
  versionId?: string;
  materialSlots: MaterialSlotInfo[];
  onVersionCreated?: () => void;
}

export function UVAtlasEditor({
  projectId,
  versionId,
  materialSlots,
  onVersionCreated,
}: UVAtlasEditorProps) {
  const [slotIndex, setSlotIndex] = useState(0);
  const [atlas, setAtlas] = useState<UvAtlasResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(20);
  const [prompt, setPrompt] = useState("");
  const [inpaintResult, setInpaintResult] = useState<string | null>(null);
  const [showWireframe, setShowWireframe] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const loadAtlas = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setInpaintResult(null);
    try {
      const result = await renderUvAtlas(projectId, versionId, slotIndex);
      setAtlas(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to render UV atlas");
    } finally {
      setLoading(false);
    }
  }, [projectId, versionId, slotIndex]);

  useEffect(() => {
    if (projectId) loadAtlas();
  }, [loadAtlas, projectId]);

  useEffect(() => {
    if (!atlas || !canvasRef.current || !maskCanvasRef.current) return;

    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const maskCtx = maskCanvas.getContext("2d")!;

    canvas.width = atlas.width;
    canvas.height = atlas.height;
    maskCanvas.width = atlas.width;
    maskCanvas.height = atlas.height;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, atlas.width, atlas.height);

      if (showWireframe && atlas.wireframe_b64) {
        const wireImg = new Image();
        wireImg.onload = () => ctx.drawImage(wireImg, 0, 0, atlas.width, atlas.height);
        wireImg.src = `data:image/png;base64,${atlas.wireframe_b64}`;
      }
    };
    img.src = inpaintResult
      ? `data:image/png;base64,${inpaintResult}`
      : `data:image/png;base64,${atlas.atlas_b64}`;

    maskCtx.clearRect(0, 0, atlas.width, atlas.height);
  }, [atlas, showWireframe, inpaintResult]);

  const pointerToCanvas = useCallback((e: React.PointerEvent) => {
    const mc = maskCanvasRef.current;
    if (!mc) return null;
    const x = e.nativeEvent.offsetX * (mc.width / mc.clientWidth);
    const y = e.nativeEvent.offsetY * (mc.height / mc.clientHeight);
    return { x, y };
  }, []);

  const scaledBrush = useMemo(
    () => brushSize * ((atlas?.width ?? 2048) / 512),
    [brushSize, atlas],
  );

  const drawDot = useCallback((x: number, y: number) => {
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (!maskCtx) return;
    maskCtx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    maskCtx.fillStyle = "rgba(0, 255, 0, 0.5)";
    maskCtx.beginPath();
    maskCtx.arc(x, y, scaledBrush / 2, 0, Math.PI * 2);
    maskCtx.fill();
  }, [tool, scaledBrush]);

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (!maskCtx) return;
    maskCtx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    maskCtx.strokeStyle = "rgba(0, 255, 0, 0.5)";
    maskCtx.lineWidth = scaledBrush;
    maskCtx.lineCap = "round";
    maskCtx.beginPath();
    maskCtx.moveTo(from.x, from.y);
    maskCtx.lineTo(to.x, to.y);
    maskCtx.stroke();
  }, [tool, scaledBrush]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const pos = pointerToCanvas(e);
    if (!pos) return;
    isDrawing.current = true;
    lastPos.current = pos;
    drawDot(pos.x, pos.y);
  }, [pointerToCanvas, drawDot]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    const pos = pointerToCanvas(e);
    if (!pos) return;
    if (lastPos.current) drawLine(lastPos.current, pos);
    lastPos.current = pos;
  }, [pointerToCanvas, drawLine]);

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false;
    lastPos.current = null;
  }, []);

  const clearMask = useCallback(() => {
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (maskCtx && atlas) {
      maskCtx.clearRect(0, 0, atlas.width, atlas.height);
    }
  }, [atlas]);

  const handleInpaint = useCallback(async () => {
    if (!atlas || !canvasRef.current || !maskCanvasRef.current || !prompt.trim()) return;
    setApplying(true);
    setError(null);

    try {
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = atlas.width;
      compositeCanvas.height = atlas.height;
      const ctx = compositeCanvas.getContext("2d")!;

      const atlasImg = new Image();
      await new Promise<void>((resolve) => {
        atlasImg.onload = () => resolve();
        atlasImg.src = inpaintResult
          ? `data:image/png;base64,${inpaintResult}`
          : `data:image/png;base64,${atlas.atlas_b64}`;
      });
      ctx.drawImage(atlasImg, 0, 0);

      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(maskCanvasRef.current, 0, 0);

      const compositeB64 = compositeCanvas.toDataURL("image/png").split(",")[1];
      const atlasB64 = inpaintResult ?? atlas.atlas_b64;

      const result = await apiFetch<{ image_b64?: string; error?: string }>("/editor/inpaint", {
        method: "POST",
        body: JSON.stringify({
          image_b64: atlasB64,
          mask_composite_b64: compositeB64,
          prompt: prompt.trim(),
        }),
      });

      if (result.error) throw new Error(result.error);
      if (result.image_b64) {
        setInpaintResult(result.image_b64);
        clearMask();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Inpaint failed");
    } finally {
      setApplying(false);
    }
  }, [atlas, prompt, inpaintResult, clearMask]);

  const handleApplyToModel = useCallback(async () => {
    if (!projectId || !inpaintResult) return;
    setApplying(true);
    setError(null);
    try {
      await applyTexture(projectId, slotIndex, "diffuse", inpaintResult, versionId);
      setInpaintResult(null);
      onVersionCreated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }, [projectId, inpaintResult, slotIndex, versionId, onVersionCreated]);

  const downloadAtlas = useCallback(() => {
    if (!atlas) return;
    const src = inpaintResult ?? atlas.atlas_b64;
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${src}`;
    a.download = `uv_atlas_slot${slotIndex}.png`;
    a.click();
  }, [atlas, inpaintResult, slotIndex]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-1.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <span className="text-[10px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
          UV Editor
        </span>

        {materialSlots.length > 1 && (
          <select
            value={slotIndex}
            onChange={(e) => setSlotIndex(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded text-[10px]"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--color-text-primary)",
            }}
          >
            {materialSlots.map((s, i) => (
              <option key={s.index} value={i}>{s.name}</option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        <ToolButton active={tool === "brush"} onClick={() => setTool("brush")} title="Brush">
          <Paintbrush className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={tool === "eraser"} onClick={() => setTool("eraser")} title="Eraser">
          <Eraser className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={false} onClick={clearMask} title="Clear Mask">
          <Undo2 className="h-3 w-3" />
        </ToolButton>

        <input
          type="range"
          min={5}
          max={100}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="w-16 accent-purple-500"
          title={`Brush size: ${brushSize}`}
        />

        <label className="flex items-center gap-1 text-[9px] cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
          <input
            type="checkbox"
            checked={showWireframe}
            onChange={(e) => setShowWireframe(e.target.checked)}
            className="accent-purple-500"
          />
          UV Wireframe
        </label>

        <button
          type="button"
          onClick={downloadAtlas}
          disabled={!atlas}
          className="p-1 rounded"
          style={{ color: "var(--color-text-muted)" }}
          title="Download atlas"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-auto flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.3)" }}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--color-text-muted)" }} />
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Rendering UV atlas...</span>
          </div>
        ) : atlas ? (
          <div className="relative" style={{ width: "fit-content", maxWidth: "100%", maxHeight: "100%" }}>
            <canvas
              ref={canvasRef}
              className="block"
              style={{ width: "100%", height: "auto" }}
            />
            <canvas
              ref={maskCanvasRef}
              className="absolute top-0 left-0"
              style={{
                width: "100%",
                height: "100%",
                cursor: "crosshair",
                pointerEvents: "auto",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Square className="h-6 w-6" style={{ color: "var(--color-text-muted)" }} />
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {projectId ? "Click a slot or load the UV atlas" : "Open a project first"}
            </span>
          </div>
        )}
      </div>

      {/* Prompt + actions bar */}
      {atlas && (
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the texture change..."
            className="flex-1 px-2 py-1.5 rounded text-[11px]"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--color-text-primary)",
            }}
          />
          <button
            type="button"
            onClick={handleInpaint}
            disabled={applying || !prompt.trim()}
            className="px-3 py-1.5 rounded text-[10px] font-semibold flex items-center gap-1"
            style={{
              background: prompt.trim() && !applying ? "rgba(139,92,246,0.7)" : "rgba(255,255,255,0.06)",
              color: prompt.trim() && !applying ? "#fff" : "var(--color-text-muted)",
              border: "none",
              cursor: prompt.trim() && !applying ? "pointer" : "default",
            }}
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Apply Inpaint
          </button>

          {inpaintResult && (
            <button
              type="button"
              onClick={handleApplyToModel}
              disabled={applying}
              className="px-3 py-1.5 rounded text-[10px] font-semibold"
              style={{
                background: !applying ? "rgba(34,197,94,0.7)" : "rgba(255,255,255,0.06)",
                color: !applying ? "#fff" : "var(--color-text-muted)",
                border: "none",
                cursor: !applying ? "pointer" : "default",
              }}
            >
              Apply to Model
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          className="shrink-0 px-3 py-1.5 text-[10px]"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1 rounded"
      style={{
        background: active ? "rgba(139,92,246,0.2)" : "transparent",
        color: active ? "#a78bfa" : "var(--color-text-muted)",
        border: active ? "1px solid rgba(139,92,246,0.3)" : "1px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
