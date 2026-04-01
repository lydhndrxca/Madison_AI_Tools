import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type CSSProperties,
} from "react";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  RefreshCw,
  Download,
  Trash2,
  Copy,
  Repeat,
  Image as ImageIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimationFrame {
  id: string;
  image_b64: string;
  width: number;
  height: number;
  duration_ms: number;
  label?: string;
}

export interface AnimationPanelProps {
  frames: AnimationFrame[];
  onFramesChange: (frames: AnimationFrame[]) => void;
  generating?: boolean;
  onGenerate: (prompt: string, frameCount: number) => void;
  onRegenerateFrame: (frameId: string) => void;
  sourceImage?: string | null;
  onNotify?: (msg: string, level: "success" | "error" | "info") => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 1;
function uid(): string {
  return `af-${Date.now()}-${_nextId++}`;
}

function loadImg(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const CHECKERBOARD =
  "repeating-conic-gradient(#2a2a2a 0% 25%, #1e1e1e 0% 50%) 0 0 / 20px 20px";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnimationPanel({
  frames,
  onFramesChange,
  generating = false,
  onGenerate,
  onRegenerateFrame,
  sourceImage,
  onNotify,
}: AnimationPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [globalDuration, setGlobalDuration] = useState(100);
  const [frameCount, setFrameCount] = useState(16);
  const [prompt, setPrompt] = useState("");
  const playingRef = useRef(false);
  const loopingRef = useRef(true);
  const framesRef = useRef(frames);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    idx: number;
  } | null>(null);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    loopingRef.current = looping;
  }, [looping]);

  // Clamp currentIdx when frames shrink
  useEffect(() => {
    if (currentIdx >= frames.length && frames.length > 0) {
      setCurrentIdx(frames.length - 1);
    }
  }, [frames.length, currentIdx]);

  // Draw current frame on canvas
  const drawFrame = useCallback(
    async (idx: number) => {
      const canvas = canvasRef.current;
      if (!canvas || frames.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const f = frames[Math.min(idx, frames.length - 1)];
      if (!f) return;

      try {
        const img = await loadImg(f.image_b64);
        canvas.width = 256;
        canvas.height = 256;
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(img, 0, 0, 256, 256);
      } catch {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = "#f66";
        ctx.font = "12px sans-serif";
        ctx.fillText("Error loading frame", 20, 130);
      }
    },
    [frames],
  );

  useEffect(() => {
    drawFrame(currentIdx);
  }, [currentIdx, drawFrame]);

  // Playback loop
  const startPlayback = useCallback(async () => {
    if (framesRef.current.length === 0) return;
    playingRef.current = true;
    setPlaying(true);
    let idx = currentIdx;

    while (playingRef.current) {
      const f = framesRef.current;
      if (f.length === 0) break;
      if (idx >= f.length) {
        if (loopingRef.current) {
          idx = 0;
        } else {
          break;
        }
      }
      setCurrentIdx(idx);
      await drawFrame(idx);
      await sleep(f[idx]?.duration_ms ?? 100);
      idx++;
    }

    playingRef.current = false;
    setPlaying(false);
  }, [currentIdx, drawFrame]);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [playing, startPlayback, stopPlayback]);

  // Frame navigation
  const goFirst = useCallback(() => {
    stopPlayback();
    setCurrentIdx(0);
  }, [stopPlayback]);
  const goPrev = useCallback(() => {
    stopPlayback();
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, [stopPlayback]);
  const goNext = useCallback(() => {
    stopPlayback();
    setCurrentIdx((i) => Math.min(frames.length - 1, i + 1));
  }, [stopPlayback, frames.length]);
  const goLast = useCallback(() => {
    stopPlayback();
    setCurrentIdx(frames.length - 1);
  }, [stopPlayback, frames.length]);

  // Per-frame duration
  const setFrameDuration = useCallback(
    (idx: number, ms: number) => {
      const next = [...frames];
      next[idx] = { ...next[idx], duration_ms: ms };
      onFramesChange(next);
    },
    [frames, onFramesChange],
  );

  const applyGlobalDuration = useCallback(() => {
    onFramesChange(frames.map((f) => ({ ...f, duration_ms: globalDuration })));
  }, [frames, globalDuration, onFramesChange]);

  // Delete / duplicate frames
  const deleteFrame = useCallback(
    (idx: number) => {
      const next = frames.filter((_, i) => i !== idx);
      onFramesChange(next);
    },
    [frames, onFramesChange],
  );

  const duplicateFrame = useCallback(
    (idx: number) => {
      const dup = { ...frames[idx], id: uid() };
      const next = [...frames];
      next.splice(idx + 1, 0, dup);
      onFramesChange(next);
    },
    [frames, onFramesChange],
  );

  // Context menu
  const handleTimelineContext = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, idx });
    },
    [],
  );
  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, []);

  // Total duration readout
  const totalMs = useMemo(
    () => frames.reduce((s, f) => s + f.duration_ms, 0),
    [frames],
  );
  const fpsDisplay = useMemo(
    () =>
      frames.length > 0
        ? (1000 / (totalMs / frames.length)).toFixed(1)
        : "0",
    [frames.length, totalMs],
  );

  // Export helpers (WebM & sprite sheet) — implemented in video-export todo
  const exportWebM = useCallback(async () => {
    if (frames.length === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as any;

    let mimeType = "video/webm; codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm";
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start();

    for (const frame of frames) {
      try {
        const img = await loadImg(frame.image_b64);
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(img, 0, 0, 256, 256);
      } catch {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, 256, 256);
      }
      track.requestFrame?.();
      await sleep(frame.duration_ms);
    }

    recorder.stop();
    await new Promise<void>((r) => {
      recorder.onstop = () => r();
    });

    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "animation.webm";
    a.click();
    URL.revokeObjectURL(url);
    onNotify?.("WebM exported", "success");
  }, [frames, onNotify]);

  const exportSpriteSheet = useCallback(async () => {
    if (frames.length === 0) return;
    const cols = Math.ceil(Math.sqrt(frames.length));
    const rows = Math.ceil(frames.length / cols);
    const canvas = document.createElement("canvas");
    canvas.width = cols * 256;
    canvas.height = rows * 256;
    const ctx = canvas.getContext("2d")!;

    for (let i = 0; i < frames.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      try {
        const img = await loadImg(frames[i].image_b64);
        ctx.drawImage(img, col * 256, row * 256, 256, 256);
      } catch {
        /* skip broken frames */
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sprite_sheet.png";
      a.click();
      URL.revokeObjectURL(url);
      onNotify?.("Sprite sheet exported", "success");
    });
  }, [frames, onNotify]);

  // Drag & drop reorder
  const dragIdx = useRef<number | null>(null);
  const handleDragStart = useCallback((idx: number) => {
    dragIdx.current = idx;
  }, []);
  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIdx.current === null || dragIdx.current === idx) return;
      const next = [...frames];
      const [removed] = next.splice(dragIdx.current, 1);
      next.splice(idx, 0, removed);
      dragIdx.current = idx;
      onFramesChange(next);
    },
    [frames, onFramesChange],
  );

  // Styles
  const panelStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    overflow: "hidden",
  };

  const hasFrames = frames.length > 0;

  return (
    <div style={panelStyle}>
      {/* ── Playback Canvas ── */}
      <div
        style={{
          flex: "1 1 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 200,
          background: CHECKERBOARD,
          position: "relative",
        }}
      >
        {hasFrames ? (
          <canvas
            ref={canvasRef}
            width={256}
            height={256}
            style={{
              imageRendering: "pixelated",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              aspectRatio: "1",
            }}
          />
        ) : (
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: 13,
              textAlign: "center",
              padding: 24,
            }}
          >
            {generating
              ? "Generating animation frames…"
              : "No frames yet. Generate or send an icon to get started."}
          </div>
        )}

        {generating && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.5)",
            }}
          >
            <div className="animate-spin" style={{ width: 28, height: 28 }}>
              <RefreshCw size={28} />
            </div>
          </div>
        )}
      </div>

      {/* ── Playback Controls ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderTop: "1px solid var(--color-border)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-secondary)",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={goFirst}
          disabled={!hasFrames}
          title="First frame"
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30"
        >
          <SkipBack size={14} />
        </button>
        <button
          onClick={goPrev}
          disabled={!hasFrames}
          title="Previous"
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30"
        >
          <SkipBack size={14} style={{ transform: "scaleX(-1)" }} />
        </button>
        <button
          onClick={togglePlay}
          disabled={!hasFrames}
          title={playing ? "Pause" : "Play"}
          className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30"
          style={{
            background: playing ? "var(--color-accent)" : undefined,
            color: playing ? "#fff" : undefined,
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          onClick={stopPlayback}
          disabled={!playing}
          title="Stop"
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30"
        >
          <Square size={14} />
        </button>
        <button
          onClick={goNext}
          disabled={!hasFrames}
          title="Next"
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30"
        >
          <SkipForward size={14} style={{ transform: "scaleX(-1)" }} />
        </button>
        <button
          onClick={goLast}
          disabled={!hasFrames}
          title="Last frame"
          className="p-1 rounded hover:bg-white/10 disabled:opacity-30"
        >
          <SkipForward size={14} />
        </button>

        <button
          onClick={() => setLooping(!looping)}
          title={looping ? "Loop On" : "Loop Off"}
          className="p-1 rounded hover:bg-white/10"
          style={{
            color: looping ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
        >
          <Repeat size={14} />
        </button>

        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            marginLeft: "auto",
          }}
        >
          {hasFrames
            ? `${currentIdx + 1}/${frames.length}  ·  ${fpsDisplay} fps  ·  ${(totalMs / 1000).toFixed(2)}s`
            : "No frames"}
        </span>
      </div>

      {/* ── Timeline Strip ── */}
      <div
        style={{
          display: "flex",
          gap: 3,
          padding: "6px 8px",
          overflowX: "auto",
          overflowY: "hidden",
          minHeight: 72,
          background: "var(--color-bg-secondary)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {frames.map((f, idx) => (
          <div
            key={f.id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onClick={() => {
              stopPlayback();
              setCurrentIdx(idx);
            }}
            onContextMenu={(e) => handleTimelineContext(e, idx)}
            style={{
              flexShrink: 0,
              width: 56,
              height: 56,
              borderRadius: 4,
              border:
                idx === currentIdx
                  ? "2px solid var(--color-accent)"
                  : "1px solid var(--color-border)",
              background: CHECKERBOARD,
              cursor: "pointer",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <img
              src={
                f.image_b64.startsWith("data:")
                  ? f.image_b64
                  : `data:image/png;base64,${f.image_b64}`
              }
              alt={f.label || `Frame ${idx + 1}`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                imageRendering: "pixelated",
              }}
            />
            <span
              style={{
                position: "absolute",
                bottom: 1,
                right: 2,
                fontSize: 9,
                background: "rgba(0,0,0,0.7)",
                color: "#ccc",
                padding: "0 3px",
                borderRadius: 2,
                lineHeight: "14px",
              }}
            >
              {idx + 1}
            </span>
          </div>
        ))}
        {frames.length === 0 && !generating && (
          <span
            style={{
              color: "var(--color-text-muted)",
              fontSize: 11,
              alignSelf: "center",
            }}
          >
            Timeline is empty
          </span>
        )}
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            padding: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            {
              icon: <RefreshCw size={12} />,
              label: "Regenerate",
              action: () => onRegenerateFrame(frames[contextMenu.idx].id),
            },
            {
              icon: <Copy size={12} />,
              label: "Duplicate",
              action: () => duplicateFrame(contextMenu.idx),
            },
            {
              icon: <Trash2 size={12} />,
              label: "Delete",
              action: () => deleteFrame(contextMenu.idx),
            },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.action();
                setContextMenu(null);
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded hover:bg-white/10 text-left"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Controls Bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px",
          background: "var(--color-bg-primary)",
          borderBottom: "1px solid var(--color-border)",
          flexWrap: "wrap",
        }}
      >
        <label
          style={{ fontSize: 10, color: "var(--color-text-muted)" }}
        >
          Frame ms:
          <input
            type="number"
            min={16}
            max={2000}
            step={10}
            value={globalDuration}
            onChange={(e) => setGlobalDuration(Number(e.target.value) || 100)}
            className="ml-1 w-14 rounded px-1 py-0.5 text-xs"
            style={{
              background: "var(--color-input-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </label>
        <button
          onClick={applyGlobalDuration}
          disabled={!hasFrames}
          className="text-[10px] px-2 py-0.5 rounded hover:bg-white/10 disabled:opacity-30"
          style={{
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          Apply to all
        </button>

        {hasFrames && (
          <label
            style={{
              fontSize: 10,
              color: "var(--color-text-muted)",
              marginLeft: "auto",
            }}
          >
            This frame:
            <input
              type="number"
              min={16}
              max={2000}
              step={10}
              value={frames[currentIdx]?.duration_ms ?? 100}
              onChange={(e) =>
                setFrameDuration(
                  currentIdx,
                  Number(e.target.value) || 100,
                )
              }
              className="ml-1 w-14 rounded px-1 py-0.5 text-xs"
              style={{
                background: "var(--color-input-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            ms
          </label>
        )}
      </div>

      {/* ── Generate & Export ── */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "8px 10px",
          background: "var(--color-bg-primary)",
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: "1 1 auto", minWidth: 140 }}>
          <label
            className="text-[10px] font-medium block mb-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            Animation prompt
          </label>
          <input
            type="text"
            placeholder="Describe the animation…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full rounded px-2 py-1 text-xs"
            style={{
              background: "var(--color-input-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
        <div style={{ minWidth: 70 }}>
          <label
            className="text-[10px] font-medium block mb-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            Frames
          </label>
          <select
            value={frameCount}
            onChange={(e) => setFrameCount(Number(e.target.value))}
            className="w-full rounded px-1 py-1 text-xs"
            style={{
              background: "var(--color-input-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            {[4, 8, 9, 12, 16, 20, 25].map((n) => (
              <option key={n} value={n}>
                {n} frames
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => onGenerate(prompt, frameCount)}
          disabled={generating}
          className="px-3 py-1.5 rounded text-xs font-medium"
          style={{
            background: "var(--color-accent)",
            color: "#fff",
            opacity: generating ? 0.5 : 1,
          }}
        >
          {generating ? "Generating…" : "Generate"}
        </button>

        <div
          style={{
            display: "flex",
            gap: 4,
            marginLeft: "auto",
          }}
        >
          <button
            onClick={exportWebM}
            disabled={!hasFrames}
            title="Export WebM video"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-white/10 disabled:opacity-30"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <Download size={12} /> WebM
          </button>
          <button
            onClick={exportSpriteSheet}
            disabled={!hasFrames}
            title="Export sprite sheet PNG"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-white/10 disabled:opacity-30"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <ImageIcon size={12} /> Sheet
          </button>
        </div>
      </div>
    </div>
  );
}
