import {
  useState, useCallback, useRef, useEffect, useMemo,
} from "react";
import {
  Download, ChevronDown, ChevronRight, Undo2, Play, Pause, Repeat,
  Volume2, VolumeX, Trash2, RotateCcw,
} from "lucide-react";
import { EditorToolbar } from "./editor/EditorToolbar";
import type { EditorTool, OutpaintDir } from "./editor/EditorToolbar";
import * as Mask from "./editor/maskEngine";
import { VideoTimeline, extractFrames, extractAudio } from "./VideoTimeline";
import type { VideoFrame, ExtractedAudio } from "./VideoTimeline";
import { applyChromaKey, getCheckerPattern, DEFAULT_CHROMA } from "@/lib/chromaKey";
import type { ChromaKeySettings } from "@/lib/chromaKey";
import { apiFetch } from "@/hooks/useApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditHistoryEntry {
  frameIdx: number;
  previousData: string | null;
  label: string;
}

export interface VideoEditorState {
  frames: VideoFrame[];
  currentFrameIdx: number;
  chromaKeySettings: ChromaKeySettings;
  editHistory: EditHistoryEntry[];
  audioEnabled?: boolean;
}

export interface VideoEditorProps {
  videoB64: string;
  prompt: string;
  onNotify: (msg: string, type: "success" | "error" | "info") => void;
  initialState?: VideoEditorState | null;
  onStateChange?: (state: VideoEditorState) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function getFrameSrc(f: VideoFrame): string {
  return f.editedData ?? f.imageData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VideoEditor({ videoB64, prompt, onNotify, initialState, onStateChange }: VideoEditorProps) {
  // Frame state
  const [frames, setFrames] = useState<VideoFrame[]>(initialState?.frames ?? []);
  const [currentIdx, setCurrentIdx] = useState(initialState?.currentFrameIdx ?? 0);
  const [extracting, setExtracting] = useState(false);

  // Playback
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(true);
  const [speed, setSpeed] = useState(1);
  const playingRef = useRef(false);

  // Chroma key
  const [chromaKey, setChromaKey] = useState<ChromaKeySettings>(initialState?.chromaKeySettings ?? { ...DEFAULT_CHROMA });

  // Edit history
  const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>(initialState?.editHistory ?? []);

  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);

  // Editor toolbar state
  const [editorTool, setEditorTool] = useState<EditorTool>("select");
  const [brushSize, setBrushSize] = useState(30);
  const [hasMask, setHasMask] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);
  const prevDrawPos = useRef<{ x: number; y: number } | null>(null);

  // Export menu
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Pre-decoded image cache for smooth playback
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Native video element ref (rendered in JSX) for hardware-accelerated playback
  const nativeVideoRef = useRef<HTMLVideoElement>(null);

  // Audio state
  const [audioEnabled, setAudioEnabled] = useState(initialState?.audioEnabled !== false);
  const [waveformPeaks, setWaveformPeaks] = useState<Float32Array | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [audioCollapsed, setAudioCollapsed] = useState(false);

  // Propagate state changes up for session persistence
  useEffect(() => {
    onStateChange?.({ frames, currentFrameIdx: currentIdx, chromaKeySettings: chromaKey, editHistory, audioEnabled });
  }, [frames, currentIdx, chromaKey, editHistory, audioEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Extract frames + audio on mount ──
  useEffect(() => {
    if (frames.length > 0) return; // already extracted (or restored)
    let cancelled = false;
    setExtracting(true);

    // Extract frames and audio in parallel
    const framesP = extractFrames(videoB64);
    const audioP = extractAudio(videoB64);

    framesP.then((extracted) => {
      if (cancelled) return;
      if (initialState?.frames?.length) {
        for (let i = 0; i < extracted.length && i < initialState.frames.length; i++) {
          if (initialState.frames[i].editedData) {
            extracted[i].editedData = initialState.frames[i].editedData;
          }
          extracted[i].enabled = initialState.frames[i].enabled;
        }
      }
      setFrames(extracted);
      if (extracted.length > 0) {
        const img = new Image();
        img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = extracted[0].imageData;
      }
      setExtracting(false);
    }).catch((e) => {
      if (!cancelled) {
        onNotify(`Frame extraction failed: ${e instanceof Error ? e.message : String(e)}`, "error");
        setExtracting(false);
      }
    });

    audioP.then((result) => {
      if (cancelled || !result) return;
      audioBufferRef.current = result.audioBuffer;
      setWaveformPeaks(result.waveformPeaks);
    });

    return () => { cancelled = true; };
  }, [videoB64]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-decode all frame images into cache for instant playback
  useEffect(() => {
    const cache = imgCacheRef.current;
    for (const frame of frames) {
      const src = getFrameSrc(frame);
      if (!cache.has(src)) {
        const img = new Image();
        img.src = src;
        cache.set(src, img);
      }
    }
  }, [frames]);

  // Can we use native <video> playback? True when no frames edited, none disabled, no chroma key.
  const canNativePlay = useMemo(() => {
    if (chromaKey.enabled) return false;
    for (const f of frames) {
      if (!f.enabled || f.editedData) return false;
    }
    return frames.length > 0;
  }, [frames, chromaKey.enabled]);

  // Detect natural size from first frame
  useEffect(() => {
    if (frames.length > 0 && naturalSize.w === 0) {
      const src = frames[0].imageData;
      const cached = imgCacheRef.current.get(src);
      if (cached?.complete && cached.naturalWidth > 0) {
        setNaturalSize({ w: cached.naturalWidth, h: cached.naturalHeight });
      } else {
        const img = new Image();
        img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = src;
      }
    }
  }, [frames, naturalSize.w]);

  // Resize mask when natural size changes
  useEffect(() => {
    if (maskCanvasRef.current && naturalSize.w > 0 && naturalSize.h > 0) {
      Mask.resizeMask(maskCanvasRef.current, naturalSize.w, naturalSize.h);
    }
  }, [naturalSize]);

  // Fit to container on first load
  useEffect(() => {
    if (naturalSize.w > 0 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = rect.width / naturalSize.w;
      const scaleY = rect.height / naturalSize.h;
      setZoom(Math.min(scaleX, scaleY) * 0.92);
      setPanX(0);
      setPanY(0);
    }
  }, [naturalSize]);

  // ── Draw current frame to viewport canvas (sync when cached) ──
  const renderFrame = useCallback((idx: number) => {
    const canvas = viewCanvasRef.current;
    if (!canvas || !frames[idx]) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const src = getFrameSrc(frames[idx]);
    const cached = imgCacheRef.current.get(src);

    const draw = (img: HTMLImageElement) => {
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      if (chromaKey.enabled) {
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        applyChromaKey(imageData, chromaKey);
        const pat = getCheckerPattern(ctx);
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        else { ctx.fillStyle = "#222"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.putImageData(imageData, 0, 0);
      } else {
        ctx.drawImage(img, 0, 0);
      }
    };

    if (cached?.complete && cached.naturalWidth > 0) {
      draw(cached);
    } else {
      const img = new Image();
      img.onload = () => { imgCacheRef.current.set(src, img); draw(img); };
      img.src = src;
    }
  }, [frames, chromaKey]);

  useEffect(() => { renderFrame(currentIdx); }, [currentIdx, renderFrame]);

  // ── Audio playback helpers ──
  const frameTimeOffset = useCallback((idx: number): number => {
    let ms = 0;
    for (let i = 0; i < idx; i++) ms += frames[i]?.duration_ms ?? 0;
    return ms / 1000;
  }, [frames]);

  const startAudio = useCallback((fromIdx: number, playbackSpeed: number) => {
    if (!audioEnabled || !audioBufferRef.current) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (audioSourceRef.current) { try { audioSourceRef.current.stop(); } catch { /* */ } }
      const source = ctx.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.playbackRate.value = playbackSpeed;
      source.connect(ctx.destination);
      const offset = frameTimeOffset(fromIdx);
      source.start(0, offset);
      audioSourceRef.current = source;
    } catch { /* audio playback is best-effort */ }
  }, [audioEnabled, frameTimeOffset]);

  const stopAudio = useCallback(() => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* */ }
      audioSourceRef.current = null;
    }
  }, []);

  // Clean up audio context on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Playback engine ──
  const playbackIdxRef = useRef(currentIdx);
  useEffect(() => { playbackIdxRef.current = currentIdx; }, [currentIdx]);

  // Track whether we're in native playback mode for the viewport rendering
  const [nativePlaying, setNativePlaying] = useState(false);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing || frames.length === 0) return;
    const vid = nativeVideoRef.current;
    const FPS = 24;
    const frameDurSec = 1 / FPS;

    // ── Native <video> path: hardware-decoded, perfect FPS ──
    if (canNativePlay && vid) {
      let cancelled = false;
      const startIdx = playbackIdxRef.current;
      vid.currentTime = startIdx * frameDurSec;
      vid.playbackRate = speed;
      vid.muted = !audioEnabled;
      vid.loop = looping;
      setNativePlaying(true);

      const onTimeUpdate = () => {
        if (cancelled) return;
        const idx = Math.min(Math.floor(vid.currentTime / frameDurSec), frames.length - 1);
        if (idx !== playbackIdxRef.current) {
          playbackIdxRef.current = idx;
          setCurrentIdx(idx);
        }
      };

      const onEnded = () => {
        if (cancelled) return;
        if (!looping) {
          setPlaying(false);
          setNativePlaying(false);
          setCurrentIdx(frames.length - 1);
        }
      };

      vid.addEventListener("timeupdate", onTimeUpdate);
      vid.addEventListener("ended", onEnded);
      vid.play().catch(() => { /* autoplay blocked — fall through */ });

      return () => {
        cancelled = true;
        vid.pause();
        vid.removeEventListener("timeupdate", onTimeUpdate);
        vid.removeEventListener("ended", onEnded);
        setNativePlaying(false);
        const idx = Math.min(Math.floor(vid.currentTime / frameDurSec), frames.length - 1);
        playbackIdxRef.current = idx;
        setCurrentIdx(idx);
      };
    }

    // ── Canvas rAF fallback (for edited/disabled frames or chroma key) ──
    let cancelled = false;
    let idx = playbackIdxRef.current;
    let lastTs = -1;
    let accum = 0;
    let stateUpdateTimer = 0;

    startAudio(idx, speed);

    const tick = (ts: number) => {
      if (cancelled || !playingRef.current) return;
      if (lastTs < 0) { lastTs = ts; requestAnimationFrame(tick); return; }
      const dt = ts - lastTs;
      lastTs = ts;
      accum += dt * speed;

      const frameDur = frames[idx]?.duration_ms ?? 41.67;
      if (accum >= frameDur) {
        accum -= frameDur;
        let next = idx + 1;
        while (next < frames.length && !frames[next].enabled) next++;
        if (next >= frames.length) {
          if (looping) {
            next = 0;
            while (next < frames.length && !frames[next].enabled) next++;
            if (next >= frames.length) { stopAudio(); setPlaying(false); setCurrentIdx(idx); return; }
            stopAudio();
            startAudio(next, speed);
          } else {
            stopAudio();
            setPlaying(false);
            setCurrentIdx(idx);
            return;
          }
        }
        idx = next;
        renderFrame(idx);
        stateUpdateTimer += frameDur;
        if (stateUpdateTimer >= 150) {
          stateUpdateTimer = 0;
          setCurrentIdx(idx);
        }
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
    return () => { cancelled = true; stopAudio(); playbackIdxRef.current = idx; setCurrentIdx(idx); };
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setCurrentIdx((i) => Math.max(0, i - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setCurrentIdx((i) => Math.min(frames.length - 1, i + 1));
          break;
        case "l":
        case "L":
          setLooping((l) => !l);
          break;
        case "[":
          setSpeed((s) => { const speeds = [0.25, 0.5, 1, 2]; const i = speeds.indexOf(s); return speeds[Math.max(0, i - 1)]; });
          break;
        case "]":
          setSpeed((s) => { const speeds = [0.25, 0.5, 1, 2]; const i = speeds.indexOf(s); return speeds[Math.min(speeds.length - 1, i + 1)]; });
          break;
        case "z":
          if (e.ctrlKey || e.metaKey) handleUndo();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [frames.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom / Pan ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const imgX = (cx - centerX - panX) / zoom;
    const imgY = (cy - centerY - panY) / zoom;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.05, Math.min(30, zoom * factor));
    setPanX(cx - centerX - imgX * newZoom);
    setPanY(cy - centerY - imgY * newZoom);
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  // Middle-click pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let captured = false;
    let lastX = 0, lastY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        captured = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!captured) return;
      setPanX((p) => p + e.clientX - lastX);
      setPanY((p) => p + e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (captured && e.button === 1) { captured = false; el.releasePointerCapture(e.pointerId); }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ── Screen to image coords ──
  const screenToImage = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!containerRef.current || !naturalSize.w) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return {
      x: (clientX - rect.left - cx - panX) / zoom + naturalSize.w / 2,
      y: (clientY - rect.top - cy - panY) / zoom + naturalSize.h / 2,
    };
  }, [panX, panY, zoom, naturalSize]);

  // ── Mask drawing ──
  const isDrawingTool = editorTool === "brush" || editorTool === "eraser" || editorTool === "smartErase";
  const inpaintMode = editorTool !== "select";

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !inpaintMode || !isDrawingTool) return;
    const pos = screenToImage(e.clientX, e.clientY);
    if (!pos || !maskCanvasRef.current) return;
    drawingRef.current = true;
    const mode = editorTool === "eraser" ? "eraser" : "brush";
    Mask.drawStroke(maskCanvasRef.current, pos.x, pos.y, null, brushSize, mode);
    prevDrawPos.current = pos;
    setHasMask(Mask.maskHasContent(maskCanvasRef.current));
  }, [inpaintMode, isDrawingTool, screenToImage, editorTool, brushSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (inpaintMode && isDrawingTool) {
      const pos = screenToImage(e.clientX, e.clientY);
      if (pos) setBrushCursor(pos);
    }
    if (!drawingRef.current || !maskCanvasRef.current) return;
    const pos = screenToImage(e.clientX, e.clientY);
    if (!pos) return;
    const mode = editorTool === "eraser" ? "eraser" : "brush";
    Mask.drawStroke(maskCanvasRef.current, pos.x, pos.y, prevDrawPos.current, brushSize, mode);
    prevDrawPos.current = pos;
    setHasMask(Mask.maskHasContent(maskCanvasRef.current));
  }, [inpaintMode, isDrawingTool, screenToImage, editorTool, brushSize]);

  const handleMouseUp = useCallback(() => {
    drawingRef.current = false;
    prevDrawPos.current = null;
  }, []);

  // ── Inpainting ──
  const currentFrame = frames[currentIdx] ?? null;
  const currentFrameSrc = currentFrame ? getFrameSrc(currentFrame) : null;

  const handleApplyInpaint = useCallback(async (inpaintPrompt: string) => {
    if (!currentFrameSrc || !maskCanvasRef.current || !Mask.maskHasContent(maskCanvasRef.current)) return;
    setEditorBusy(true);
    try {
      const compositeB64 = await Mask.exportMaskComposite(maskCanvasRef.current, currentFrameSrc);
      const imageB64 = currentFrameSrc.replace(/^data:image\/\w+;base64,/, "");
      const res = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/inpaint", {
        method: "POST",
        body: JSON.stringify({ image_b64: imageB64, mask_composite_b64: compositeB64, prompt: inpaintPrompt }),
      });
      if (res.image_b64) {
        const newSrc = `data:image/png;base64,${res.image_b64}`;
        // Save history
        setEditHistory((h) => [...h, { frameIdx: currentIdx, previousData: currentFrame!.editedData, label: `Inpaint: ${inpaintPrompt.slice(0, 30)}` }]);
        setFrames((prev) => {
          const next = [...prev];
          next[currentIdx] = { ...next[currentIdx], editedData: newSrc };
          return next;
        });
        Mask.clearMask(maskCanvasRef.current);
        setHasMask(false);
        onNotify("Frame inpainted", "success");
      } else {
        onNotify(res.error || "Inpaint failed", "error");
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEditorBusy(false);
    }
  }, [currentFrameSrc, currentIdx, currentFrame, onNotify]);

  const handleSmartSelect = useCallback(async (subject: string) => {
    if (!currentFrameSrc) return;
    setEditorBusy(true);
    try {
      const imageB64 = currentFrameSrc.replace(/^data:image\/\w+;base64,/, "");
      const res = await apiFetch<{ mask_b64?: string; error?: string }>("/editor/smart-select", {
        method: "POST",
        body: JSON.stringify({ image_b64: imageB64, subject }),
      });
      if (res.mask_b64 && maskCanvasRef.current) {
        Mask.resizeMask(maskCanvasRef.current, naturalSize.w, naturalSize.h);
        await Mask.applyMaskImage(maskCanvasRef.current, `data:image/png;base64,${res.mask_b64}`);
        setHasMask(true);
      } else {
        onNotify(res.error || "Smart select returned no mask", "error");
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEditorBusy(false);
    }
  }, [currentFrameSrc, naturalSize, onNotify]);

  const handleSmartErase = useCallback(async () => {
    if (!currentFrameSrc || !maskCanvasRef.current || !Mask.maskHasContent(maskCanvasRef.current)) return;
    setEditorBusy(true);
    try {
      const compositeB64 = await Mask.exportMaskComposite(maskCanvasRef.current, currentFrameSrc);
      const imageB64 = currentFrameSrc.replace(/^data:image\/\w+;base64,/, "");
      const res = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/smart-erase", {
        method: "POST",
        body: JSON.stringify({ image_b64: imageB64, mask_composite_b64: compositeB64 }),
      });
      if (res.image_b64) {
        const newSrc = `data:image/png;base64,${res.image_b64}`;
        setEditHistory((h) => [...h, { frameIdx: currentIdx, previousData: currentFrame!.editedData, label: "Smart erase" }]);
        setFrames((prev) => {
          const next = [...prev];
          next[currentIdx] = { ...next[currentIdx], editedData: newSrc };
          return next;
        });
        Mask.clearMask(maskCanvasRef.current);
        setHasMask(false);
        onNotify("Frame smart-erased", "success");
      } else {
        onNotify(res.error || "Smart erase failed", "error");
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEditorBusy(false);
    }
  }, [currentFrameSrc, currentIdx, currentFrame, onNotify]);

  const handleRemoveBg = useCallback(async (replacement: string) => {
    if (!currentFrameSrc) return;
    setEditorBusy(true);
    try {
      const imageB64 = currentFrameSrc.replace(/^data:image\/\w+;base64,/, "");
      const res = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/remove-bg", {
        method: "POST",
        body: JSON.stringify({ image_b64: imageB64, replacement }),
      });
      if (res.image_b64) {
        const newSrc = `data:image/png;base64,${res.image_b64}`;
        setEditHistory((h) => [...h, { frameIdx: currentIdx, previousData: currentFrame!.editedData, label: "Remove BG" }]);
        setFrames((prev) => {
          const next = [...prev];
          next[currentIdx] = { ...next[currentIdx], editedData: newSrc };
          return next;
        });
        onNotify("Background removed", "success");
      } else {
        onNotify(res.error || "Remove BG failed", "error");
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEditorBusy(false);
    }
  }, [currentFrameSrc, currentIdx, currentFrame, onNotify]);

  const handleStyleTransfer = useCallback(async (presetId: string, custom: string) => {
    if (!currentFrameSrc) return;
    setEditorBusy(true);
    try {
      const imageB64 = currentFrameSrc.replace(/^data:image\/\w+;base64,/, "");
      const res = await apiFetch<{ image_b64: string | null; error?: string }>("/editor/style-transfer", {
        method: "POST",
        body: JSON.stringify({ image_b64: imageB64, style_preset: presetId, custom_prompt: custom }),
      });
      if (res.image_b64) {
        const newSrc = `data:image/png;base64,${res.image_b64}`;
        setEditHistory((h) => [...h, { frameIdx: currentIdx, previousData: currentFrame!.editedData, label: `Style: ${presetId}` }]);
        setFrames((prev) => {
          const next = [...prev];
          next[currentIdx] = { ...next[currentIdx], editedData: newSrc };
          return next;
        });
        onNotify("Style transferred", "success");
      } else {
        onNotify(res.error || "Style transfer failed", "error");
      }
    } catch (e) {
      onNotify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEditorBusy(false);
    }
  }, [currentFrameSrc, currentIdx, currentFrame, onNotify]);

  const handleOutpaint = useCallback(async (_dir: OutpaintDir, _px: number, _prompt: string) => {
    onNotify("Outpaint is not supported for video frames", "info");
  }, [onNotify]);

  const handleClearMask = useCallback(() => {
    if (maskCanvasRef.current) { Mask.clearMask(maskCanvasRef.current); setHasMask(false); }
  }, []);

  const handleToolChange = useCallback((tool: EditorTool) => {
    setEditorTool(tool);
  }, []);

  // ── Undo ──
  const handleUndo = useCallback(() => {
    if (editHistory.length === 0) return;
    const last = editHistory[editHistory.length - 1];
    setFrames((prev) => {
      const next = [...prev];
      next[last.frameIdx] = { ...next[last.frameIdx], editedData: last.previousData };
      return next;
    });
    setEditHistory((h) => h.slice(0, -1));
    setCurrentIdx(last.frameIdx);
    onNotify(`Undone: ${last.label}`, "info");
  }, [editHistory, onNotify]);

  // ── Revert current frame ──
  const handleRevertFrame = useCallback(() => {
    if (!currentFrame?.editedData) return;
    setEditHistory((h) => [...h, { frameIdx: currentIdx, previousData: currentFrame.editedData, label: "Revert frame" }]);
    setFrames((prev) => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], editedData: null };
      return next;
    });
    onNotify("Frame reverted to original", "info");
  }, [currentFrame, currentIdx, onNotify]);

  // ── Export helpers ──
  const exportSingleFrame = useCallback(() => {
    if (!currentFrameSrc) return;
    const a = document.createElement("a");
    a.href = currentFrameSrc;
    a.download = `frame_${String(currentIdx + 1).padStart(3, "0")}.png`;
    a.click();
    onNotify("Frame saved", "success");
  }, [currentFrameSrc, currentIdx, onNotify]);

  const exportPngSequence = useCallback(async () => {
    onNotify("Packing PNG sequence…", "info");
    // Dynamic import JSZip if available, else manual download
    const enabledFrames = frames.filter((f) => f.enabled);
    for (let i = 0; i < enabledFrames.length; i++) {
      const a = document.createElement("a");
      a.href = getFrameSrc(enabledFrames[i]);
      a.download = `frame_${String(i + 1).padStart(3, "0")}.png`;
      a.click();
      await sleep(50);
    }
    onNotify(`Saved ${enabledFrames.length} frames`, "success");
  }, [frames, onNotify]);

  const exportVideo = useCallback(async (preferMp4: boolean) => {
    const enabledFrames = frames.filter((f) => f.enabled);
    if (enabledFrames.length === 0) return;

    const w = naturalSize.w || 640;
    const h = naturalSize.h || 360;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const videoStream = canvas.captureStream(0);
    const videoTrack = videoStream.getVideoTracks()[0] as unknown as { requestFrame?: () => void };

    // Set up audio stream if audio is enabled
    let exportAudioCtx: AudioContext | null = null;
    let exportAudioSource: AudioBufferSourceNode | null = null;
    let mergedStream: MediaStream;

    if (audioEnabled && audioBufferRef.current) {
      try {
        exportAudioCtx = new AudioContext();
        const dest = exportAudioCtx.createMediaStreamDestination();
        exportAudioSource = exportAudioCtx.createBufferSource();
        exportAudioSource.buffer = audioBufferRef.current;
        exportAudioSource.connect(dest);
        const audioTrack = dest.stream.getAudioTracks()[0];
        mergedStream = new MediaStream([videoStream.getVideoTracks()[0], audioTrack]);
      } catch {
        mergedStream = videoStream;
        exportAudioCtx = null;
      }
    } else {
      mergedStream = videoStream;
    }

    let mimeType = "";
    let ext = "";
    let label = "";
    if (preferMp4) {
      for (const mt of ["video/mp4; codecs=avc1", "video/mp4; codecs=avc1.42E01E", "video/mp4"]) {
        if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; ext = "mp4"; label = "MP4"; break; }
      }
    }
    if (!mimeType) {
      for (const mt of ["video/webm; codecs=vp9", "video/webm; codecs=vp8", "video/webm"]) {
        if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; ext = "webm"; label = "WebM"; break; }
      }
    }
    if (!mimeType) { onNotify("No supported video codec found", "error"); return; }

    onNotify(`Recording ${label}${exportAudioSource ? " with audio" : ""}…`, "info");
    const recorder = new MediaRecorder(mergedStream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();

    // Start audio playback into the recorder stream
    if (exportAudioSource) exportAudioSource.start(0);

    for (const frame of enabledFrames) {
      try {
        const img = await loadImg(getFrameSrc(frame));
        if (chromaKey.enabled) {
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h);
          applyChromaKey(data, chromaKey);
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          ctx.putImageData(data, 0, 0);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
        }
      } catch {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, w, h);
      }
      videoTrack.requestFrame?.();
      await sleep(frame.duration_ms);
    }

    // Stop audio source
    if (exportAudioSource) { try { exportAudioSource.stop(); } catch { /* */ } }
    if (exportAudioCtx) { try { exportAudioCtx.close(); } catch { /* */ } }

    recorder.stop();
    await new Promise<void>((r) => { recorder.onstop = () => r(); });
    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `video_export.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
    onNotify(`${label} exported`, "success");
  }, [frames, naturalSize, chromaKey, audioEnabled, onNotify]);

  const exportGif = useCallback(async () => {
    const enabledFrames = frames.filter((f) => f.enabled);
    if (enabledFrames.length === 0) return;
    onNotify("Encoding GIF…", "info");

    const w = naturalSize.w || 640;
    const h = naturalSize.h || 360;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    function quantise(imageData: ImageData) {
      const { data, width, height } = imageData;
      const palette: number[] = [];
      const paletteMap = new Map<number, number>();
      const pixels = new Uint8Array(width * height);
      let transparentIdx = -1;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const pi = i / 4;
        if (a < 128) {
          if (transparentIdx === -1) { transparentIdx = palette.length / 3; palette.push(0, 0, 0); }
          pixels[pi] = transparentIdx;
          continue;
        }
        const qr = r & 0xfc, qg = g & 0xfc, qb = b & 0xfc;
        const key = (qr << 16) | (qg << 8) | qb;
        let idx = paletteMap.get(key);
        if (idx === undefined) {
          if (palette.length / 3 >= 256) {
            let bestDist = Infinity, bestIdx = 0;
            for (let p = 0; p < palette.length; p += 3) {
              const dr = palette[p] - qr, dg = palette[p + 1] - qg, db = palette[p + 2] - qb;
              const d = dr * dr + dg * dg + db * db;
              if (d < bestDist) { bestDist = d; bestIdx = p / 3; }
            }
            idx = bestIdx;
          } else {
            idx = palette.length / 3;
            palette.push(qr, qg, qb);
          }
          paletteMap.set(key, idx);
        }
        pixels[pi] = idx;
      }
      let colorRes = 1;
      while ((1 << (colorRes + 1)) < Math.max(palette.length / 3, 4)) colorRes++;
      const palSize = 1 << (colorRes + 1);
      while (palette.length / 3 < palSize) palette.push(0, 0, 0);
      return { palette: new Uint8Array(palette), pixels, colorRes, transparentIdx, palSize };
    }

    function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
      const clearCode = 1 << minCodeSize;
      const eoiCode = clearCode + 1;
      const out: number[] = [];
      let codeSize = minCodeSize + 1;
      let nextCode = eoiCode + 1;
      const table = new Map<string, number>();
      function initTable() {
        table.clear();
        for (let i = 0; i < clearCode; i++) table.set(String(i), i);
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
      let buffer = 0, bufBits = 0;
      function writeCode(code: number) {
        buffer |= code << bufBits;
        bufBits += codeSize;
        while (bufBits >= 8) { out.push(buffer & 0xff); buffer >>= 8; bufBits -= 8; }
      }
      initTable();
      writeCode(clearCode);
      let cur = String(pixels[0]);
      for (let i = 1; i < pixels.length; i++) {
        const next = cur + "," + pixels[i];
        if (table.has(next)) { cur = next; }
        else {
          writeCode(table.get(cur)!);
          if (nextCode < 4096) { table.set(next, nextCode++); if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++; }
          else { writeCode(clearCode); initTable(); }
          cur = String(pixels[i]);
        }
      }
      writeCode(table.get(cur)!);
      writeCode(eoiCode);
      if (bufBits > 0) out.push(buffer & 0xff);
      return new Uint8Array(out);
    }

    function subBlock(data: Uint8Array): Uint8Array {
      const blocks: number[] = [];
      for (let i = 0; i < data.length;) {
        const chunk = Math.min(255, data.length - i);
        blocks.push(chunk);
        for (let j = 0; j < chunk; j++) blocks.push(data[i++]);
      }
      blocks.push(0);
      return new Uint8Array(blocks);
    }

    const parts: BlobPart[] = [];
    function push(...arrays: Uint8Array[]) { for (const a of arrays) parts.push(a as unknown as BlobPart); }

    push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
    push(new Uint8Array([w & 0xff, w >> 8, h & 0xff, h >> 8, 0x00, 0x00, 0x00]));
    push(new Uint8Array([0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
      0x03, 0x01, 0x00, 0x00, 0x00]));

    for (const frame of enabledFrames) {
      try {
        const img = await loadImg(getFrameSrc(frame));
        if (chromaKey.enabled) {
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h);
          applyChromaKey(data, chromaKey);
          ctx.clearRect(0, 0, w, h);
          ctx.putImageData(data, 0, 0);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
        }
      } catch {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, w, h);
      }
      const imageData = ctx.getImageData(0, 0, w, h);
      if (!chromaKey.enabled) {
        const d = imageData.data;
        for (let px = 0; px < d.length; px += 4) {
          if (d[px] < 8 && d[px + 1] < 8 && d[px + 2] < 8) d[px + 3] = 0;
        }
      }
      const { palette, pixels, colorRes, transparentIdx } = quantise(imageData);
      const delay = Math.round(frame.duration_ms / 10);
      const hasTransp = transparentIdx >= 0;
      const packed = (hasTransp ? 0x01 : 0x00) | 0x08;
      push(new Uint8Array([0x21, 0xf9, 0x04, packed, delay & 0xff, delay >> 8, hasTransp ? transparentIdx : 0x00, 0x00]));
      const lctFlag = 0x80 | colorRes;
      push(new Uint8Array([0x2c, 0x00, 0x00, 0x00, 0x00, w & 0xff, w >> 8, h & 0xff, h >> 8, lctFlag]));
      push(palette);
      const minCodeSize = colorRes + 1;
      push(new Uint8Array([minCodeSize]));
      push(subBlock(lzwEncode(pixels, minCodeSize)));
    }
    push(new Uint8Array([0x3b]));

    const blob = new Blob(parts, { type: "image/gif" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "video_export.gif";
    a.click();
    URL.revokeObjectURL(a.href);
    onNotify("GIF exported", "success");
  }, [frames, naturalSize, chromaKey, onNotify]);

  // Close export menu on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  // Collapse state for bottom panels
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [frameStripCollapsed, setFrameStripCollapsed] = useState(false);

  // Filmstrip timeline: sample every Nth frame for the visual strip
  const timelineRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const filmstripSamples = useMemo(() => {
    if (frames.length === 0) return [];
    const count = Math.min(frames.length, 80);
    const step = frames.length / count;
    const samples: { idx: number; src: string }[] = [];
    for (let i = 0; i < count; i++) {
      const fi = Math.min(Math.floor(i * step), frames.length - 1);
      samples.push({ idx: fi, src: getFrameSrc(frames[fi]) });
    }
    return samples;
  }, [frames]);

  const totalDurationMs = useMemo(() => {
    let ms = 0;
    for (const f of frames) ms += f.duration_ms;
    return ms;
  }, [frames]);

  const playheadPct = frames.length > 0 ? (currentIdx / (frames.length - 1)) * 100 : 0;

  const seekFromTimeline = useCallback((clientX: number) => {
    if (!timelineRef.current || frames.length === 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.round(pct * (frames.length - 1));
    setCurrentIdx(idx);
  }, [frames.length]);

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setScrubbing(true);
    seekFromTimeline(e.clientX);
  }, [seekFromTimeline]);

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: MouseEvent) => seekFromTimeline(e.clientX);
    const onUp = () => setScrubbing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [scrubbing, seekFromTimeline]);

  // ── Render ──
  const imgTransform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;
  const showBrushCursor = inpaintMode && isDrawingTool && brushCursor;

  const enabledCount = useMemo(() => frames.filter((f) => f.enabled).length, [frames]);

  const timeMarkers = useMemo(() => {
    if (totalDurationMs === 0) return [];
    const marks: { pct: number; label: string }[] = [];
    const intervalMs = totalDurationMs <= 4000 ? 500 : totalDurationMs <= 10000 ? 1000 : 2000;
    for (let t = 0; t <= totalDurationMs; t += intervalMs) {
      const s = t / 1000;
      marks.push({ pct: (t / totalDurationMs) * 100, label: s % 1 === 0 ? `${s}s` : `${s.toFixed(1)}s` });
    }
    return marks;
  }, [totalDurationMs]);

  // ── Waveform canvas rendering ──
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const hasAudio = waveformPeaks !== null;

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveformPeaks || !audioEnabled) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const barCount = waveformPeaks.length;
    const barWidth = w / barCount;
    const mid = h / 2;

    for (let i = 0; i < barCount; i++) {
      const amp = waveformPeaks[i];
      const barH = Math.max(1, amp * mid * 0.9);
      const x = i * barWidth;
      ctx.fillStyle = "rgba(94, 201, 224, 0.6)";
      ctx.fillRect(x, mid - barH, Math.max(barWidth - 0.5, 0.5), barH * 2);
    }
  }, [waveformPeaks, audioEnabled, audioCollapsed]);

  if (extracting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ background: "#0a0a0a" }}>
        <div className="w-6 h-6 rounded-full animate-spin" style={{ border: "2px solid var(--color-border)", borderTopColor: "var(--color-accent)" }} />
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Extracting frames…</p>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "#0a0a0a" }}>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>No frames available</p>
      </div>
    );
  }

  const TimelineIcon = timelineCollapsed ? ChevronRight : ChevronDown;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Editor Toolbar */}
      <EditorToolbar
        activeTool={editorTool}
        onToolChange={handleToolChange}
        brushSize={brushSize}
        onBrushSizeChange={setBrushSize}
        hasMask={hasMask}
        onClearMask={handleClearMask}
        onApplyInpaint={handleApplyInpaint}
        onSmartSelect={handleSmartSelect}
        onSmartErase={handleSmartErase}
        onOutpaint={handleOutpaint}
        onRemoveBg={handleRemoveBg}
        onStyleTransfer={handleStyleTransfer}
        busy={editorBusy}
      />

      {/* Viewport + Controls Row */}
      <div className="flex-1 flex min-h-0">
        {/* Main viewport */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          style={{ background: "#0a0a0a", cursor: inpaintMode && isDrawingTool ? "none" : "default" }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { handleMouseUp(); setBrushCursor(null); }}
        >
          {/* Native video element for hardware-accelerated playback */}
          <video
            ref={nativeVideoRef}
            playsInline
            preload="auto"
            src={`data:video/mp4;base64,${videoB64}`}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: imgTransform,
              transformOrigin: "center",
              width: naturalSize.w || undefined,
              height: naturalSize.h || undefined,
              display: nativePlaying ? "block" : "none",
            }}
          />
          {/* Frame canvas — hidden during native playback */}
          <canvas
            ref={viewCanvasRef}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: imgTransform,
              transformOrigin: "center",
              imageRendering: zoom > 3 ? "pixelated" : "auto",
              display: nativePlaying ? "none" : "block",
            }}
          />
          {/* Mask overlay */}
          <canvas
            ref={maskCanvasRef}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: imgTransform,
              transformOrigin: "center",
              opacity: 0.5,
              pointerEvents: "none",
            }}
          />
          {/* Brush cursor */}
          {showBrushCursor && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) translate(${(brushCursor.x - naturalSize.w / 2) * zoom}px, ${(brushCursor.y - naturalSize.h / 2) * zoom}px)`,
                width: brushSize * zoom,
                height: brushSize * zoom,
                borderRadius: "50%",
                border: "1.5px solid rgba(255,255,255,.7)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>

        {/* Side panel: Chroma Key + Actions */}
        <div className="w-[200px] shrink-0 overflow-y-auto p-2 space-y-3" style={{ borderLeft: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          {/* Chroma Key Controls */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Chroma Key</p>
            <label className="flex items-center gap-2 text-[10px] cursor-pointer" style={{ color: "var(--color-text-primary)" }}>
              <input
                type="checkbox"
                checked={chromaKey.enabled}
                onChange={(e) => setChromaKey((s) => ({ ...s, enabled: e.target.checked }))}
              />
              Enable
            </label>
            {chromaKey.enabled && (
              <div className="space-y-1.5">
                <div>
                  <label className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Tolerance ({chromaKey.tolerance})</label>
                  <input type="range" min={0} max={100} value={chromaKey.tolerance} onChange={(e) => setChromaKey((s) => ({ ...s, tolerance: Number(e.target.value) }))} className="w-full h-1" />
                </div>
                <div>
                  <label className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Edge Feather ({chromaKey.edgeFeather})</label>
                  <input type="range" min={0} max={20} value={chromaKey.edgeFeather} onChange={(e) => setChromaKey((s) => ({ ...s, edgeFeather: Number(e.target.value) }))} className="w-full h-1" />
                </div>
                <div>
                  <label className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>Spill Suppression ({chromaKey.spillSuppression})</label>
                  <input type="range" min={0} max={100} value={chromaKey.spillSuppression} onChange={(e) => setChromaKey((s) => ({ ...s, spillSuppression: Number(e.target.value) }))} className="w-full h-1" />
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid var(--color-border)" }} />

          {/* Frame actions */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Frame</p>
            {currentFrame?.editedData && (
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                onClick={handleRevertFrame}
              >
                <Undo2 size={10} /> Revert to Original
              </button>
            )}
            {editHistory.length > 0 && (
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] rounded cursor-pointer"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                onClick={handleUndo}
              >
                <Undo2 size={10} /> Undo ({editHistory[editHistory.length - 1].label.slice(0, 20)})
              </button>
            )}
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid var(--color-border)" }} />

          {/* Frame Duration (all frames) */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Frame Duration</p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={Math.round(frames[0]?.duration_ms ?? 42)}
                onChange={(e) => {
                  const ms = Math.max(1, Math.min(1000, Number(e.target.value) || 42));
                  setFrames((prev) => prev.map((f) => ({ ...f, duration_ms: ms })));
                }}
                className="w-16 px-1.5 py-0.5 text-[10px] rounded"
                style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              />
              <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>ms</span>
              <span className="text-[9px] ml-auto" style={{ color: "var(--color-text-muted)" }}>
                {(1000 / (frames[0]?.duration_ms ?? 42)).toFixed(1)} fps
              </span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {[{label:"12", ms: 83}, {label:"24", ms: 42}, {label:"30", ms: 33}, {label:"60", ms: 17}].map((p) => (
                <button
                  key={p.label}
                  className="px-1.5 py-0.5 text-[9px] rounded cursor-pointer"
                  style={{
                    background: Math.round(frames[0]?.duration_ms ?? 0) === p.ms ? "var(--color-accent)" : "var(--color-input-bg)",
                    border: "1px solid var(--color-border)",
                    color: Math.round(frames[0]?.duration_ms ?? 0) === p.ms ? "var(--color-foreground)" : "var(--color-text-muted)",
                  }}
                  onClick={() => setFrames((prev) => prev.map((f) => ({ ...f, duration_ms: p.ms })))}
                >
                  {p.label}fps
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid var(--color-border)" }} />

          {/* Export */}
          <div className="space-y-2" ref={exportRef}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Export</p>
            <div className="relative">
              <button
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] rounded cursor-pointer"
                style={{ background: "var(--color-accent)", border: "none", color: "var(--color-foreground)" }}
                onClick={() => setExportOpen((o) => !o)}
              >
                <Download size={10} /> Export <ChevronDown size={10} className="ml-auto" />
              </button>
              {exportOpen && (
                <div
                  className="absolute top-full left-0 right-0 mt-1 rounded overflow-hidden z-50 shadow-lg"
                  style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
                >
                  {[
                    { label: "MP4 Video", fn: () => exportVideo(true) },
                    { label: "WebM Video", fn: () => exportVideo(false) },
                    { label: "GIF (transparent)", fn: exportGif },
                    { label: `PNG Sequence (${enabledCount})`, fn: exportPngSequence },
                    { label: "Current Frame PNG", fn: exportSingleFrame },
                  ].map((item) => (
                    <button
                      key={item.label}
                      className="w-full text-left px-3 py-1.5 text-[10px] cursor-pointer hover:bg-[var(--color-surface)]"
                      style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
                      onClick={() => { setExportOpen(false); item.fn(); }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div style={{ borderTop: "1px solid var(--color-border)" }} />
          <div className="text-[9px] space-y-0.5" style={{ color: "var(--color-text-muted)" }}>
            <p>{frames.length} frames • {naturalSize.w}×{naturalSize.h}</p>
            <p>Space: play/pause • Arrows: step</p>
            <p>L: loop • [ ]: speed • Ctrl+Z: undo</p>
          </div>
        </div>
      </div>

      {/* ── Filmstrip Timeline (collapsible) ── */}
      <div className="shrink-0" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}>
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button
            className="p-0.5 rounded cursor-pointer"
            style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
            onClick={() => setTimelineCollapsed((c) => !c)}
            title={timelineCollapsed ? "Show timeline" : "Hide timeline"}
          >
            <TimelineIcon size={12} />
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Timeline</span>
          <span className="text-[9px] ml-1" style={{ color: "var(--color-text-muted)" }}>
            {(totalDurationMs / 1000).toFixed(1)}s • {frames.length} frames
          </span>
          {/* Playback controls inline */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              className="p-0.5 rounded cursor-pointer"
              style={{ background: "none", border: "none", color: playing ? "var(--color-accent)" : "var(--color-text-muted)" }}
              onClick={() => setPlaying((p) => !p)}
              title={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
            <button
              className="p-0.5 rounded cursor-pointer"
              style={{ background: "none", border: "none", color: looping ? "var(--color-accent)" : "var(--color-text-muted)" }}
              onClick={() => setLooping((l) => !l)}
              title="Loop"
            >
              <Repeat size={12} />
            </button>
            <span className="text-[9px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
              {speed}×
            </span>
          </div>
        </div>
        {!timelineCollapsed && (
          <div className="px-3 pb-2 select-none">
            {/* Time ruler */}
            <div className="relative h-4 mb-1" style={{ userSelect: "none" }}>
              {timeMarkers.map((m, i) => (
                <span
                  key={i}
                  className="absolute text-[8px]"
                  style={{ left: `${m.pct}%`, transform: "translateX(-50%)", color: "var(--color-text-muted)" }}
                >
                  {m.label}
                </span>
              ))}
            </div>
            {/* Filmstrip + playhead */}
            <div
              ref={timelineRef}
              className="relative rounded overflow-hidden"
              style={{
                height: 56,
                cursor: scrubbing ? "grabbing" : "pointer",
                background: "#111",
              }}
              onMouseDown={handleTimelineMouseDown}
            >
              {/* Filmstrip frames */}
              <div className="flex h-full">
                {filmstripSamples.map((s, i) => (
                  <img
                    key={i}
                    src={s.src}
                    alt=""
                    draggable={false}
                    className="h-full object-cover"
                    style={{
                      flex: "1 1 0%",
                      minWidth: 0,
                      opacity: frames[s.idx]?.enabled === false ? 0.3 : 1,
                    }}
                  />
                ))}
              </div>
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0"
                style={{
                  left: `${playheadPct}%`,
                  width: 2,
                  background: "var(--color-accent)",
                  boxShadow: "0 0 6px var(--color-accent)",
                  transform: "translateX(-1px)",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              />
              {/* Playhead top handle */}
              <div
                className="absolute"
                style={{
                  left: `${playheadPct}%`,
                  top: -2,
                  width: 10,
                  height: 10,
                  transform: "translateX(-5px)",
                  background: "var(--color-accent)",
                  borderRadius: "2px 2px 50% 50%",
                  pointerEvents: "none",
                  zIndex: 3,
                }}
              />
              {/* Disabled regions overlay */}
              {frames.length > 0 && (() => {
                const regions: { start: number; end: number }[] = [];
                let rStart = -1;
                for (let i = 0; i < frames.length; i++) {
                  if (!frames[i].enabled) {
                    if (rStart < 0) rStart = i;
                  } else if (rStart >= 0) {
                    regions.push({ start: rStart, end: i - 1 });
                    rStart = -1;
                  }
                }
                if (rStart >= 0) regions.push({ start: rStart, end: frames.length - 1 });
                return regions.map((r, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${(r.start / frames.length) * 100}%`,
                      width: `${((r.end - r.start + 1) / frames.length) * 100}%`,
                      background: "rgba(255,0,0,0.15)",
                      borderLeft: "1px solid rgba(255,0,0,0.4)",
                      borderRight: "1px solid rgba(255,0,0,0.4)",
                      pointerEvents: "none",
                      zIndex: 1,
                    }}
                  />
                ));
              })()}
            </div>
            {/* Current time readout */}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                Frame {currentIdx + 1} / {frames.length}
              </span>
              <span className="text-[9px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                {(() => {
                  let ms = 0;
                  for (let i = 0; i < currentIdx; i++) ms += frames[i].duration_ms;
                  return (ms / 1000).toFixed(2);
                })()}s / {(totalDurationMs / 1000).toFixed(2)}s
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Audio Track (collapsible, only if audio detected) ── */}
      {hasAudio && (
        <div className="shrink-0" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <button
              className="p-0.5 rounded cursor-pointer"
              style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
              onClick={() => setAudioCollapsed((c) => !c)}
              title={audioCollapsed ? "Show audio" : "Hide audio"}
            >
              {audioCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Audio</span>
            {audioEnabled && audioBufferRef.current && (
              <span className="text-[9px] ml-1" style={{ color: "var(--color-text-muted)" }}>
                {audioBufferRef.current.duration.toFixed(1)}s • {audioBufferRef.current.sampleRate / 1000}kHz
              </span>
            )}
            <div className="flex items-center gap-1 ml-auto">
              {/* Mute / unmute toggle */}
              <button
                className="p-0.5 rounded cursor-pointer"
                style={{ background: "none", border: "none", color: audioEnabled ? "var(--color-accent)" : "var(--color-text-muted)" }}
                onClick={() => setAudioEnabled((e) => !e)}
                title={audioEnabled ? "Mute audio" : "Unmute audio"}
              >
                {audioEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
              </button>
              {/* Delete / restore audio */}
              {audioEnabled ? (
                <button
                  className="p-0.5 rounded cursor-pointer"
                  style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
                  onClick={() => setAudioEnabled(false)}
                  title="Remove audio track"
                >
                  <Trash2 size={11} />
                </button>
              ) : (
                <button
                  className="p-0.5 rounded cursor-pointer"
                  style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
                  onClick={() => setAudioEnabled(true)}
                  title="Restore audio track"
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
          </div>
          {!audioCollapsed && audioEnabled && (
            <div className="px-3 pb-2 select-none">
              <div
                className="relative rounded overflow-hidden"
                style={{ height: 48, background: "#0d1117", cursor: scrubbing ? "grabbing" : "pointer" }}
                onMouseDown={handleTimelineMouseDown}
              >
                <canvas
                  ref={waveformCanvasRef}
                  className="w-full h-full"
                  style={{ display: "block" }}
                />
                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${playheadPct}%`,
                    width: 2,
                    background: "var(--color-accent)",
                    boxShadow: "0 0 6px var(--color-accent)",
                    transform: "translateX(-1px)",
                    pointerEvents: "none",
                    zIndex: 2,
                  }}
                />
              </div>
            </div>
          )}
          {!audioCollapsed && !audioEnabled && (
            <div className="px-3 pb-2">
              <div className="flex items-center justify-center rounded" style={{ height: 48, background: "#0d1117" }}>
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Audio removed — click restore to bring it back</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Frame Strip (collapsible) ── */}
      <VideoTimeline
        frames={frames}
        currentIdx={currentIdx}
        onSeek={setCurrentIdx}
        onFramesChange={setFrames}
        playing={playing}
        onPlayPause={() => setPlaying((p) => !p)}
        looping={looping}
        onLoopToggle={() => setLooping((l) => !l)}
        speed={speed}
        onSpeedChange={setSpeed}
        collapsed={frameStripCollapsed}
        onToggleCollapse={() => setFrameStripCollapsed((c) => !c)}
      />
    </div>
  );
}
