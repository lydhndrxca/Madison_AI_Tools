import { useState, useRef, useCallback, useEffect } from "react";
import { ArrowRight, Circle, Square, Type, Pencil, Trash2, Download, Eye, EyeOff } from "lucide-react";

export type AnnotationType = "arrow" | "circle" | "rect" | "text" | "freehand";

export interface Annotation {
  id: string;
  type: AnnotationType;
  color: string;
  lineWidth: number;
  points: { x: number; y: number }[];
  text?: string;
  width?: number;
  height?: number;
}

interface AnnotationLayerProps {
  width: number;
  height: number;
  zoom: number;
  transform: string;
  visible: boolean;
  onVisibilityChange: (v: boolean) => void;
  annotations: Annotation[];
  onAnnotationsChange: (anns: Annotation[]) => void;
  activeTool: AnnotationType | null;
  onToolChange: (tool: AnnotationType | null) => void;
  /** If provided, renders as a toolbar strip */
  showToolbar?: boolean;
}

const TOOL_DEFS: { id: AnnotationType; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "arrow", label: "Arrow", Icon: ArrowRight },
  { id: "circle", label: "Circle", Icon: Circle },
  { id: "rect", label: "Rectangle", Icon: Square },
  { id: "freehand", label: "Freehand", Icon: Pencil },
  { id: "text", label: "Text", Icon: Type },
];

const COLORS = ["#ff4444", "#ff9900", "#ffdd00", "#44cc44", "#4488ff", "#ffffff"];

export function AnnotationToolbar({
  annotations,
  onAnnotationsChange,
  activeTool,
  onToolChange,
  visible,
  onVisibilityChange,
  color,
  onColorChange,
  lineWidth,
  onLineWidthChange,
  onExportWithAnnotations,
}: {
  annotations: Annotation[];
  onAnnotationsChange: (a: Annotation[]) => void;
  activeTool: AnnotationType | null;
  onToolChange: (t: AnnotationType | null) => void;
  visible: boolean;
  onVisibilityChange: (v: boolean) => void;
  color: string;
  onColorChange: (c: string) => void;
  lineWidth: number;
  onLineWidthChange: (w: number) => void;
  onExportWithAnnotations?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: "1px solid var(--color-border)" }}>
      <span className="text-[10px] mr-1" style={{ color: "var(--color-text-muted)" }}>Annotate</span>
      {TOOL_DEFS.map((t) => (
        <button
          key={t.id}
          onClick={() => onToolChange(activeTool === t.id ? null : t.id)}
          className="p-1 rounded cursor-pointer transition-colors"
          style={{
            background: activeTool === t.id ? "rgba(255,255,255,0.1)" : "transparent",
            color: activeTool === t.id ? "#fff" : "var(--color-text-muted)",
            border: activeTool === t.id ? "1px solid rgba(255,255,255,0.2)" : "1px solid transparent",
          }}
          title={t.label}
        >
          <t.Icon className="h-3.5 w-3.5" />
        </button>
      ))}
      <span className="mx-1 w-px h-4" style={{ background: "var(--color-border)" }} />
      {COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onColorChange(c)}
          className="w-4 h-4 rounded-full cursor-pointer shrink-0"
          style={{
            background: c,
            border: color === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)",
            transform: color === c ? "scale(1.15)" : undefined,
          }}
        />
      ))}
      <span className="mx-1 w-px h-4" style={{ background: "var(--color-border)" }} />
      <input
        type="range"
        min={1}
        max={8}
        value={lineWidth}
        onChange={(e) => onLineWidthChange(Number(e.target.value))}
        className="w-16 h-3"
        title={`Line width: ${lineWidth}`}
      />
      <span className="mx-1 w-px h-4" style={{ background: "var(--color-border)" }} />
      <button
        onClick={() => onVisibilityChange(!visible)}
        className="p-1 rounded cursor-pointer"
        style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
        title={visible ? "Hide annotations" : "Show annotations"}
      >
        {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
      {annotations.length > 0 && (
        <>
          <button
            onClick={() => onAnnotationsChange([])}
            className="p-1 rounded cursor-pointer"
            style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
            title="Clear all annotations"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {onExportWithAnnotations && (
            <button
              onClick={onExportWithAnnotations}
              className="p-1 rounded cursor-pointer"
              style={{ color: "var(--color-text-muted)", border: "none", background: "transparent" }}
              title="Export image with annotations burned in"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function AnnotationCanvas({
  width,
  height,
  zoom,
  transform,
  visible,
  annotations,
  onAnnotationsChange,
  activeTool,
  color,
  lineWidth,
}: {
  width: number;
  height: number;
  zoom: number;
  transform: string;
  visible: boolean;
  annotations: Annotation[];
  onAnnotationsChange: (a: Annotation[]) => void;
  activeTool: AnnotationType | null;
  color: string;
  lineWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const currentPoints = useRef<{ x: number; y: number }[]>([]);

  const toImageCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / (rect.width / width),
      y: (clientY - rect.top) / (rect.height / height),
    };
  }, [width, height]);

  const drawAll = useCallback((ctx: CanvasRenderingContext2D, anns: Annotation[], preview?: Annotation) => {
    ctx.clearRect(0, 0, width, height);
    const toDraw = [...anns];
    if (preview) toDraw.push(preview);

    for (const ann of toDraw) {
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (ann.type === "freehand" && ann.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) ctx.lineTo(ann.points[i].x, ann.points[i].y);
        ctx.stroke();
      } else if (ann.type === "arrow" && ann.points.length >= 2) {
        const start = ann.points[0];
        const end = ann.points[ann.points.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 12 + ann.lineWidth * 2;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (ann.type === "rect" && ann.points.length >= 2) {
        const s = ann.points[0];
        const e = ann.points[ann.points.length - 1];
        ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y);
      } else if (ann.type === "circle" && ann.points.length >= 2) {
        const s = ann.points[0];
        const e = ann.points[ann.points.length - 1];
        const rx = Math.abs(e.x - s.x) / 2;
        const ry = Math.abs(e.y - s.y) / 2;
        const cx = (s.x + e.x) / 2;
        const cy = (s.y + e.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ann.type === "text" && ann.text && ann.points.length >= 1) {
        const p = ann.points[0];
        const fontSize = Math.max(14, ann.lineWidth * 5);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = ann.color;
        const pad = 4;
        const metrics = ctx.measureText(ann.text);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(p.x - pad, p.y - fontSize - pad, metrics.width + pad * 2, fontSize + pad * 2);
        ctx.fillStyle = ann.color;
        ctx.fillText(ann.text, p.x, p.y);
      }
    }
  }, [width, height]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawAll(ctx, annotations);
  }, [annotations, drawAll]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeTool || !visible) return;
    if (activeTool === "text") {
      const pos = toImageCoords(e.clientX, e.clientY);
      const text = window.prompt("Annotation text:");
      if (text?.trim()) {
        const ann: Annotation = {
          id: crypto.randomUUID(),
          type: "text",
          color,
          lineWidth,
          points: [pos],
          text: text.trim(),
        };
        onAnnotationsChange([...annotations, ann]);
      }
      return;
    }
    drawing.current = true;
    currentPoints.current = [toImageCoords(e.clientX, e.clientY)];
  }, [activeTool, visible, color, lineWidth, annotations, onAnnotationsChange, toImageCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawing.current || !activeTool || !canvasRef.current) return;
    const pos = toImageCoords(e.clientX, e.clientY);
    if (activeTool === "freehand") {
      currentPoints.current.push(pos);
    } else {
      currentPoints.current = [currentPoints.current[0], pos];
    }
    const ctx = canvasRef.current.getContext("2d");
    if (ctx) {
      const preview: Annotation = {
        id: "preview",
        type: activeTool,
        color,
        lineWidth,
        points: [...currentPoints.current],
      };
      drawAll(ctx, annotations, preview);
    }
  }, [activeTool, color, lineWidth, annotations, drawAll, toImageCoords]);

  const handleMouseUp = useCallback(() => {
    if (!drawing.current || !activeTool) return;
    drawing.current = false;
    if (currentPoints.current.length >= 2) {
      const ann: Annotation = {
        id: crypto.randomUUID(),
        type: activeTool,
        color,
        lineWidth,
        points: [...currentPoints.current],
      };
      onAnnotationsChange([...annotations, ann]);
    }
    currentPoints.current = [];
  }, [activeTool, color, lineWidth, annotations, onAnnotationsChange]);

  if (!visible || width === 0 || height === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform,
        transformOrigin: "center center",
        pointerEvents: activeTool ? "auto" : "none",
        cursor: activeTool === "text" ? "text" : activeTool ? "crosshair" : "default",
        width,
        height,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { if (drawing.current) handleMouseUp(); }}
    />
  );
}

/** Renders annotations onto a source image and returns a data URL. */
export function exportWithAnnotations(
  imageSrc: string,
  annotations: Annotation[],
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      for (const ann of annotations) {
        ctx.strokeStyle = ann.color;
        ctx.fillStyle = ann.color;
        ctx.lineWidth = ann.lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (ann.type === "freehand" && ann.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(ann.points[0].x, ann.points[0].y);
          for (let i = 1; i < ann.points.length; i++) ctx.lineTo(ann.points[i].x, ann.points[i].y);
          ctx.stroke();
        } else if (ann.type === "arrow" && ann.points.length >= 2) {
          const start = ann.points[0];
          const end = ann.points[ann.points.length - 1];
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLen = 12 + ann.lineWidth * 2;
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        } else if (ann.type === "rect" && ann.points.length >= 2) {
          const s = ann.points[0];
          const e = ann.points[ann.points.length - 1];
          ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y);
        } else if (ann.type === "circle" && ann.points.length >= 2) {
          const s = ann.points[0];
          const e = ann.points[ann.points.length - 1];
          const rx = Math.abs(e.x - s.x) / 2;
          const ry = Math.abs(e.y - s.y) / 2;
          const cx = (s.x + e.x) / 2;
          const cy = (s.y + e.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (ann.type === "text" && ann.text && ann.points.length >= 1) {
          const p = ann.points[0];
          const fontSize = Math.max(14, ann.lineWidth * 5);
          ctx.font = `bold ${fontSize}px sans-serif`;
          const pad = 4;
          const metrics = ctx.measureText(ann.text);
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(p.x - pad, p.y - fontSize - pad, metrics.width + pad * 2, fontSize + pad * 2);
          ctx.fillStyle = ann.color;
          ctx.fillText(ann.text, p.x, p.y);
        }
      }

      resolve(canvas.toDataURL("image/png"));
    };
    img.src = imageSrc;
  });
}
