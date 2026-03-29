import { useRef, useCallback, useEffect, useState, type ComponentType, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowRight, Circle, Square, Type, Pencil, Eraser, Trash2, Download, Eye, EyeOff } from "lucide-react";

export type AnnotationType = "arrow" | "circle" | "rect" | "text" | "freehand" | "eraser";

const ERASER_HIT_PX = 15;

function eraseAnnotationsNear(anns: Annotation[], x: number, y: number, threshold: number): Annotation[] {
  return anns.filter(
    (ann) => !ann.points.some((p) => Math.hypot(p.x - x, p.y - y) <= threshold),
  );
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  lineWidth: number,
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const headLen = 15 + lineWidth * 3;
  const trim = Math.min(headLen, Math.max(0, dist - 0.5));
  const endTrimmed = {
    x: end.x - trim * Math.cos(angle),
    y: end.y - trim * Math.sin(angle),
  };
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(endTrimmed.x, endTrimmed.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

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

const TOOL_DEFS: { id: AnnotationType; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "arrow", label: "Arrow", Icon: ArrowRight },
  { id: "circle", label: "Circle", Icon: Circle },
  { id: "rect", label: "Rectangle", Icon: Square },
  { id: "freehand", label: "Freehand", Icon: Pencil },
  { id: "eraser", label: "Eraser", Icon: Eraser },
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

function mapAnnPointsToLocal(
  ann: Annotation,
  ox: number,
  oy: number,
  worldMode: boolean,
): Annotation {
  if (!worldMode) return ann;
  return {
    ...ann,
    points: ann.points.map((p) => ({ x: p.x - ox, y: p.y - oy })),
  };
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
  worldPlacement,
}: {
  width: number;
  height: number;
  zoom: number;
  /** Ignored when `worldPlacement` is set (parent applies pan/zoom). */
  transform?: string;
  visible: boolean;
  annotations: Annotation[];
  onAnnotationsChange: (a: Annotation[]) => void;
  activeTool: AnnotationType | null;
  color: string;
  lineWidth: number;
  /** When set, points are stored in absolute world coords; layer is positioned at x,y with size width×height. */
  worldPlacement?: { x: number; y: number; width: number; height: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const currentPoints = useRef<{ x: number; y: number }[]>([]);
  const annotationsRef = useRef(annotations);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const textDraftRef = useRef("");
  const textInputPosRef = useRef<{ x: number; y: number } | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    textDraftRef.current = textDraft;
  }, [textDraft]);
  useEffect(() => {
    textInputPosRef.current = textInputPos;
  }, [textInputPos]);
  useEffect(() => {
    if (textInputPos) queueMicrotask(() => textInputRef.current?.focus());
  }, [textInputPos]);

  const ox = worldPlacement?.x ?? 0;
  const oy = worldPlacement?.y ?? 0;
  const worldMode = Boolean(worldPlacement);

  const toImageCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const localX = (clientX - rect.left) / (rect.width / width);
    const localY = (clientY - rect.top) / (rect.height / height);
    if (worldPlacement) {
      return { x: worldPlacement.x + localX, y: worldPlacement.y + localY };
    }
    return { x: localX, y: localY };
  }, [width, height, worldPlacement]);

  const drawAll = useCallback((ctx: CanvasRenderingContext2D, anns: Annotation[], preview?: Annotation) => {
    ctx.clearRect(0, 0, width, height);
    const toDraw = [...anns];
    if (preview) toDraw.push(preview);

    for (const ann of toDraw) {
      const a = mapAnnPointsToLocal(ann, ox, oy, worldMode);
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = a.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (a.type === "freehand" && a.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(a.points[0].x, a.points[0].y);
        for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
        ctx.stroke();
      } else if (a.type === "arrow" && a.points.length >= 2) {
        const start = a.points[0];
        const end = a.points[a.points.length - 1];
        drawArrow(ctx, start, end, a.lineWidth);
      } else if (a.type === "rect" && a.points.length >= 2) {
        const s = a.points[0];
        const e = a.points[a.points.length - 1];
        ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y);
      } else if (a.type === "circle" && a.points.length >= 2) {
        const s = a.points[0];
        const e = a.points[a.points.length - 1];
        const rx = Math.abs(e.x - s.x) / 2;
        const ry = Math.abs(e.y - s.y) / 2;
        const cx = (s.x + e.x) / 2;
        const cy = (s.y + e.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.type === "text" && a.text && a.points.length >= 1) {
        const p = a.points[0];
        const fontSize = Math.max(14, a.lineWidth * 5);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = a.color;
        const pad = 4;
        const metrics = ctx.measureText(a.text);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(p.x - pad, p.y - fontSize - pad, metrics.width + pad * 2, fontSize + pad * 2);
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, p.x, p.y);
      }
    }
  }, [width, height, ox, oy, worldMode]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawAll(ctx, annotations);
  }, [annotations, drawAll]);

  const commitTextAt = useCallback(
    (pos: { x: number; y: number }, text: string) => {
      const t = text.trim();
      if (!t) return;
      const ann: Annotation = {
        id: crypto.randomUUID(),
        type: "text",
        color,
        lineWidth,
        points: [pos],
        text: t,
      };
      const next = [...annotationsRef.current, ann];
      annotationsRef.current = next;
      onAnnotationsChange(next);
    },
    [color, lineWidth, onAnnotationsChange],
  );

  const flushTextOverlay = useCallback(() => {
    const pos = textInputPosRef.current;
    if (!pos) return;
    const raw = textDraftRef.current;
    textInputPosRef.current = null;
    setTextInputPos(null);
    setTextDraft("");
    textDraftRef.current = "";
    commitTextAt(pos, raw);
  }, [commitTextAt]);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!activeTool || !visible) return;
      e.stopPropagation();
      e.preventDefault();
      if (activeTool === "text") {
        const pos = toImageCoords(e.clientX, e.clientY);
        setTextInputPos(pos);
        textInputPosRef.current = pos;
        setTextDraft("");
        textDraftRef.current = "";
        return;
      }
      if (activeTool === "eraser") {
        const pos = toImageCoords(e.clientX, e.clientY);
        const next = eraseAnnotationsNear(annotationsRef.current, pos.x, pos.y, ERASER_HIT_PX);
        annotationsRef.current = next;
        onAnnotationsChange(next);
        drawing.current = true;
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) drawAll(ctx, next);
        return;
      }
      drawing.current = true;
      currentPoints.current = [toImageCoords(e.clientX, e.clientY)];
    },
    [activeTool, visible, toImageCoords, onAnnotationsChange, drawAll],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!activeTool || !canvasRef.current) return;
      if (activeTool === "eraser" && drawing.current) {
        e.stopPropagation();
        e.preventDefault();
        const pos = toImageCoords(e.clientX, e.clientY);
        const next = eraseAnnotationsNear(annotationsRef.current, pos.x, pos.y, ERASER_HIT_PX);
        annotationsRef.current = next;
        onAnnotationsChange(next);
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) drawAll(ctx, next);
        return;
      }
      if (!drawing.current) return;
      e.stopPropagation();
      e.preventDefault();
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
    },
    [activeTool, color, lineWidth, annotations, drawAll, toImageCoords, onAnnotationsChange],
  );

  const handleMouseUp = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !activeTool) return;
    e.stopPropagation();
    drawing.current = false;
    if (activeTool === "eraser") return;
    if (currentPoints.current.length >= 2) {
      const ann: Annotation = {
        id: crypto.randomUUID(),
        type: activeTool,
        color,
        lineWidth,
        points: [...currentPoints.current],
      };
      const next = [...annotationsRef.current, ann];
      annotationsRef.current = next;
      onAnnotationsChange(next);
    }
    currentPoints.current = [];
  }, [activeTool, color, lineWidth, onAnnotationsChange]);

  if (width === 0 || height === 0) return null;

  const textFontSize = Math.max(14, lineWidth * 5);
  const textLeftLocal = textInputPos
    ? worldMode ? textInputPos.x - ox : textInputPos.x
    : 0;
  const textTopLocal = textInputPos
    ? worldMode ? textInputPos.y - oy : textInputPos.y
    : 0;

  const wrapperStyle: CSSProperties = worldPlacement
    ? {
        position: "absolute",
        left: worldPlacement.x,
        top: worldPlacement.y,
        width: worldPlacement.width,
        height: worldPlacement.height,
        transform: "none",
        transformOrigin: "top left",
        pointerEvents: activeTool && visible ? "auto" : "none",
        zIndex: 500,
      }
    : {
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: transform ?? "none",
        transformOrigin: "center center",
        width,
        height,
        pointerEvents: activeTool && visible ? "auto" : "none",
      };

  return (
    <div
      style={wrapperStyle}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          display: "block",
          cursor:
            activeTool === "text"
              ? "text"
              : activeTool === "eraser"
                ? "crosshair"
                : activeTool
                  ? "crosshair"
                  : "default",
          opacity: visible ? 1 : 0,
          width,
          height,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={(e) => {
          if (drawing.current) handleMouseUp(e);
        }}
      />
      {textInputPos && (
        <input
          ref={textInputRef}
          value={textDraft}
          onChange={(ev) => {
            setTextDraft(ev.target.value);
            textDraftRef.current = ev.target.value;
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              flushTextOverlay();
            }
            if (ev.key === "Escape") {
              ev.preventDefault();
              textInputPosRef.current = null;
              setTextInputPos(null);
              setTextDraft("");
              textDraftRef.current = "";
            }
          }}
          onBlur={flushTextOverlay}
          className="rounded border-none outline-none ring-1 ring-white/40"
          style={{
            position: "absolute",
            left: textLeftLocal,
            top: textTopLocal - textFontSize - 4,
            minWidth: 120,
            fontSize: textFontSize,
            fontWeight: 700,
            fontFamily: "sans-serif",
            color,
            background: "rgba(0,0,0,0.75)",
            padding: "2px 6px",
            zIndex: 2,
          }}
          placeholder="Text…"
        />
      )}
    </div>
  );
}

/** Renders annotations onto a source image and returns a data URL. */
export function exportWithAnnotations(
  imageSrc: string,
  annotations: Annotation[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Failed to load image for annotation export"));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Could not get 2d canvas context")); return; }
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
          drawArrow(ctx, start, end, ann.lineWidth);
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
