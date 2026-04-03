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
  ChevronLeft,
  ChevronRight,
  Undo2,
  Sliders,
  SunMedium,
  Contrast,
  Paintbrush,
  Droplets,
  RotateCw,
} from "lucide-react";
import type { ModelInfo } from "@/hooks/ModelsContext";

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
  alternatives?: string[];
  activeAltIdx?: number;
}

export interface RegenOptions {
  modelId?: string;
  count?: number;
  notes?: string;
}

export interface AnimationPanelProps {
  frames: AnimationFrame[];
  onFramesChange: (frames: AnimationFrame[]) => void;
  generating?: boolean;
  onGenerate: (prompt: string, frameCount: number) => void;
  onRegenerateFrame: (frameId: string, opts?: RegenOptions) => void;
  sourceImage?: string | null;
  onNotify?: (msg: string, level: "success" | "error" | "info") => void;
  models?: ModelInfo[];
  defaultModelId?: string;
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

const CHECKERBOARD =
  "repeating-conic-gradient(#2a2a2a 0% 25%, #1e1e1e 0% 50%) 0 0 / 20px 20px";

// ---------------------------------------------------------------------------
// Manual WebM encoder — based on the proven whammy.js approach.
// Each frame: canvas → WebP (toDataURL) → extract VP8 bitstream → WebM/EBML
// ---------------------------------------------------------------------------

function parseWebP(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extractVP8(webp: Uint8Array): Uint8Array | null {
  if (webp.length < 20) return null;
  let off = 12;
  while (off < webp.length - 8) {
    const tag = String.fromCharCode(webp[off], webp[off + 1], webp[off + 2], webp[off + 3]);
    const sz = webp[off + 4] | (webp[off + 5] << 8) | (webp[off + 6] << 16) | (webp[off + 7] << 24);
    if (tag === "VP8 ") return webp.slice(off + 8, off + 8 + sz);
    off += 8 + sz + (sz & 1);
  }
  return null;
}

function numToBuffer(num: number): Uint8Array {
  const bytes: number[] = [];
  let v = num;
  do { bytes.unshift(v & 0xFF); v = Math.floor(v / 256); } while (v > 0);
  return new Uint8Array(bytes.length ? bytes : [0]);
}

function strToBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function float64ToBuffer(val: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, val);
  return new Uint8Array(buf);
}

interface EBMLNode {
  id: number;
  data: Uint8Array | EBMLNode[];
}

function serializeEBML(nodes: EBMLNode[]): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const node of nodes) {
    // Encode element ID
    const idBytes: number[] = [];
    let idVal = node.id;
    const idBuf: number[] = [];
    do { idBuf.unshift(idVal & 0xFF); idVal = Math.floor(idVal / 256); } while (idVal > 0);
    for (const b of idBuf) idBytes.push(b);

    // Encode data
    let data: Uint8Array;
    if (node.data instanceof Uint8Array) {
      data = node.data;
    } else {
      data = serializeEBML(node.data);
    }

    // VINT-encode the size
    const len = data.length;
    let sizeBytes: number[];
    if (len <= 0x7E) {
      sizeBytes = [0x80 | len];
    } else if (len <= 0x3FFE) {
      sizeBytes = [0x40 | (len >> 8), len & 0xFF];
    } else if (len <= 0x1FFFFE) {
      sizeBytes = [0x20 | (len >> 16), (len >> 8) & 0xFF, len & 0xFF];
    } else {
      sizeBytes = [0x10 | ((len >> 24) & 0x0F), (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF];
    }

    const elem = new Uint8Array(idBytes.length + sizeBytes.length + data.length);
    elem.set(idBytes, 0);
    elem.set(sizeBytes, idBytes.length);
    elem.set(data, idBytes.length + sizeBytes.length);
    parts.push(elem);
  }

  let total = 0;
  for (const p of parts) total += p.length;
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result;
}

function makeSimpleBlock(trackNum: number, timecode: number, keyframe: boolean, frameData: Uint8Array): Uint8Array {
  const flags = keyframe ? 0x80 : 0;
  const header = new Uint8Array([
    trackNum | 0x80,
    (timecode >> 8) & 0xFF,
    timecode & 0xFF,
    flags,
  ]);
  const result = new Uint8Array(header.length + frameData.length);
  result.set(header, 0);
  result.set(frameData, header.length);
  return result;
}

async function buildWebMVideo(
  images: (HTMLImageElement | null)[],
  frameDurations: number[],
  width: number,
  height: number,
): Promise<Blob> {
  const cvs = document.createElement("canvas");
  cvs.width = width;
  cvs.height = height;
  const ctx = cvs.getContext("2d")!;

  // Step 1: convert each frame to VP8 via WebP
  const vp8Frames: Uint8Array[] = [];
  for (let i = 0; i < images.length; i++) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (images[i]) ctx.drawImage(images[i]!, 0, 0, width, height);
    const dataUrl = cvs.toDataURL("image/webp", 0.85);
    if (!dataUrl.includes("image/webp")) {
      throw new Error("Browser does not support WebP encoding");
    }
    const webpBytes = parseWebP(dataUrl);
    const vp8 = extractVP8(webpBytes);
    if (!vp8) throw new Error(`Frame ${i}: could not extract VP8 bitstream from WebP`);
    vp8Frames.push(vp8);
  }

  const totalDuration = frameDurations.reduce((a, b) => a + b, 0);

  // Step 2: build clusters — one per frame (most compatible structure)
  const clusters: EBMLNode[] = [];
  let absMs = 0;
  for (let i = 0; i < vp8Frames.length; i++) {
    clusters.push({
      id: 0x1F43B675, // Cluster
      data: [
        { id: 0xE7, data: numToBuffer(absMs) }, // Timecode
        { id: 0xA3, data: makeSimpleBlock(1, 0, true, vp8Frames[i]) }, // SimpleBlock
      ],
    });
    absMs += frameDurations[i];
  }

  // Step 3: assemble full EBML document
  const doc: EBMLNode[] = [
    { id: 0x1A45DFA3, data: [ // EBML Header
      { id: 0x4286, data: numToBuffer(1) },     // EBMLVersion
      { id: 0x42F7, data: numToBuffer(1) },     // EBMLReadVersion
      { id: 0x42F2, data: numToBuffer(4) },     // EBMLMaxIDLength
      { id: 0x42F3, data: numToBuffer(8) },     // EBMLMaxSizeLength
      { id: 0x4282, data: strToBuffer("webm") }, // DocType
      { id: 0x4287, data: numToBuffer(2) },     // DocTypeVersion
      { id: 0x4285, data: numToBuffer(2) },     // DocTypeReadVersion
    ]},
    { id: 0x18538067, data: [ // Segment
      { id: 0x1549A966, data: [ // Info
        { id: 0x2AD7B1, data: numToBuffer(1000000) }, // TimecodeScale (1ms)
        { id: 0x4D80, data: strToBuffer("AnimPanel") }, // MuxingApp
        { id: 0x5741, data: strToBuffer("AnimPanel") }, // WritingApp
        { id: 0x4489, data: float64ToBuffer(totalDuration) }, // Duration
      ]},
      { id: 0x1654AE6B, data: [ // Tracks
        { id: 0xAE, data: [ // TrackEntry
          { id: 0xD7, data: numToBuffer(1) },       // TrackNumber
          { id: 0x73C5, data: numToBuffer(1) },     // TrackUID
          { id: 0x9C, data: numToBuffer(0) },       // FlagLacing
          { id: 0x22B59C, data: strToBuffer("und") }, // Language
          { id: 0x86, data: strToBuffer("V_VP8") }, // CodecID
          { id: 0x83, data: numToBuffer(1) },       // TrackType (video)
          { id: 0xE0, data: [                        // Video
            { id: 0xB0, data: numToBuffer(width) },  // PixelWidth
            { id: 0xBA, data: numToBuffer(height) }, // PixelHeight
          ]},
        ]},
      ]},
      ...clusters,
    ]},
  ];

  const bytes = serializeEBML(doc);
  return new Blob([new Uint8Array(bytes)], { type: "video/webm" });
}

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
  models = [],
  defaultModelId = "",
}: AnimationPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameW = useMemo(() => (frames.length > 0 ? frames[0].width : 256), [frames]);
  const frameH = useMemo(() => (frames.length > 0 ? frames[0].height : 256), [frames]);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);
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

  // Regen panel state
  const [showRegenPanel, setShowRegenPanel] = useState(false);
  const [regenModelId, setRegenModelId] = useState(defaultModelId);
  const [regenCount, setRegenCount] = useState(2);
  const [regenNotes, setRegenNotes] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  // Image adjustment state
  const [adjustMode, setAdjustMode] = useState(false);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [hueRotation, setHueRotation] = useState(0);

  // Undo stack
  const [editHistory, setEditHistory] = useState<{ frameIdx: number; previousData: string; label: string }[]>([]);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    loopingRef.current = looping;
  }, [looping]);

  // Cancel rAF on unmount
  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

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
        canvas.width = frameW;
        canvas.height = frameH;
        ctx.clearRect(0, 0, frameW, frameH);
        ctx.drawImage(img, 0, 0, frameW, frameH);
      } catch {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, frameW, frameH);
        ctx.fillStyle = "#f66";
        ctx.font = "12px sans-serif";
        ctx.fillText("Error loading frame", 20, frameH / 2);
      }
    },
    [frames, frameW, frameH],
  );

  useEffect(() => {
    drawFrame(currentIdx);
  }, [currentIdx, drawFrame]);

  // Playback loop — uses rAF + performance.now() for deterministic timing
  const rafRef = useRef<number | null>(null);
  const playbackOrigin = useRef<{ t0: number; startIdx: number }>({ t0: 0, startIdx: 0 });

  const startPlayback = useCallback(() => {
    const f = framesRef.current;
    if (f.length === 0) return;
    playingRef.current = true;
    setPlaying(true);
    playbackOrigin.current = { t0: performance.now(), startIdx: currentIdx };

    const tick = () => {
      if (!playingRef.current) return;
      const fr = framesRef.current;
      if (fr.length === 0) { playingRef.current = false; setPlaying(false); return; }

      const { t0, startIdx } = playbackOrigin.current;
      const elapsed = performance.now() - t0;

      // Walk cumulative schedule from startIdx to find current frame
      let cum = 0;
      let idx = startIdx;
      for (let i = startIdx; i < fr.length; i++) {
        const dur = fr[i]?.duration_ms ?? 100;
        if (cum + dur > elapsed) { idx = i; break; }
        cum += dur;
        idx = i + 1;
      }

      if (idx >= fr.length) {
        if (loopingRef.current) {
          playbackOrigin.current = { t0: performance.now(), startIdx: 0 };
          idx = 0;
        } else {
          setCurrentIdx(fr.length - 1);
          drawFrame(fr.length - 1);
          playingRef.current = false;
          setPlaying(false);
          return;
        }
      }

      setCurrentIdx(idx);
      drawFrame(idx);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [currentIdx, drawFrame]);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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

  // ── Undo ──
  const pushUndo = useCallback((frameIdx: number, previousData: string, label: string) => {
    setEditHistory((h) => [...h, { frameIdx, previousData, label }]);
  }, []);

  const handleUndo = useCallback(() => {
    if (editHistory.length === 0) return;
    const last = editHistory[editHistory.length - 1];
    setEditHistory((h) => h.slice(0, -1));
    const next = [...frames];
    if (next[last.frameIdx]) {
      next[last.frameIdx] = { ...next[last.frameIdx], image_b64: last.previousData };
      onFramesChange(next);
      setCurrentIdx(last.frameIdx);
      onNotify?.(`Undo: ${last.label}`, "info");
    }
  }, [editHistory, frames, onFramesChange, onNotify]);

  // Keyboard: Ctrl+Z for undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo]);

  // ── Alternative cycling ──
  const cycleAlternative = useCallback((idx: number, dir: 1 | -1) => {
    const f = frames[idx];
    if (!f || !f.alternatives || f.alternatives.length === 0) return;
    const allImages = [f.image_b64, ...f.alternatives.filter((a) => a !== f.image_b64)];
    if (allImages.length <= 1) return;
    const currentAltIdx = f.activeAltIdx ?? 0;
    let next = currentAltIdx + dir;
    if (next < 0) next = allImages.length - 1;
    if (next >= allImages.length) next = 0;

    pushUndo(idx, f.image_b64, "Switch alternative");
    const updated = [...frames];
    updated[idx] = { ...f, image_b64: allImages[next], activeAltIdx: next };
    onFramesChange(updated);
  }, [frames, onFramesChange, pushUndo]);

  // ── Regenerate frame ──
  const handleRegenerate = useCallback(() => {
    const f = frames[currentIdx];
    if (!f || regenerating) return;
    setRegenerating(true);
    onRegenerateFrame(f.id, {
      modelId: regenModelId || undefined,
      count: regenCount,
      notes: regenNotes || undefined,
    });
  }, [frames, currentIdx, regenerating, onRegenerateFrame, regenModelId, regenCount, regenNotes]);

  // Reset regenerating when generating stops
  useEffect(() => {
    if (!generating) setRegenerating(false);
  }, [generating]);

  // ── Image adjustments ──
  const resetAdjust = useCallback(() => {
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setHueRotation(0);
  }, []);

  const applyAdjustment = useCallback(async () => {
    const f = frames[currentIdx];
    if (!f) return;
    if (brightness === 0 && contrast === 0 && saturation === 0 && hueRotation === 0) return;

    pushUndo(currentIdx, f.image_b64, "Adjust image");

    const img = await loadImg(f.image_b64);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.filter = `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100}) saturate(${1 + saturation / 100}) hue-rotate(${hueRotation}deg)`;
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");

    const next = [...frames];
    next[currentIdx] = { ...f, image_b64: b64 };
    onFramesChange(next);
    resetAdjust();
    onNotify?.("Adjustment applied", "success");
  }, [frames, currentIdx, brightness, contrast, saturation, hueRotation, pushUndo, onFramesChange, resetAdjust, onNotify]);

  // Live adjustment preview on canvas
  useEffect(() => {
    if (!adjustMode) return;
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const f = frames[currentIdx];
    if (!f) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    loadImg(f.image_b64).then((img) => {
      if (cancelled) return;
      canvas.width = frameW;
      canvas.height = frameH;
      ctx.clearRect(0, 0, frameW, frameH);
      if (brightness === 0 && contrast === 0 && saturation === 0 && hueRotation === 0) {
        ctx.drawImage(img, 0, 0, frameW, frameH);
      } else {
        ctx.filter = `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100}) saturate(${1 + saturation / 100}) hue-rotate(${hueRotation}deg)`;
        ctx.drawImage(img, 0, 0, frameW, frameH);
        ctx.filter = "none";
      }
    });
    return () => { cancelled = true; };
  }, [adjustMode, brightness, contrast, saturation, hueRotation, frames, currentIdx, frameW, frameH]);

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

  // ── Minimal GIF89a encoder (no dependencies) ──
  const buildGif = useCallback(
    async (gw: number, gh: number): Promise<Blob> => {
      const canvas = document.createElement("canvas");
      canvas.width = gw;
      canvas.height = gh;
      const ctx = canvas.getContext("2d")!;

      // Quantise a frame into a 256-colour palette + indexed pixels
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
            if (transparentIdx === -1) {
              transparentIdx = palette.length / 3;
              palette.push(0, 0, 0);
            }
            pixels[pi] = transparentIdx;
            continue;
          }
          // Reduce to 6-bit per channel for palette dedup
          const qr = r & 0xfc, qg = g & 0xfc, qb = b & 0xfc;
          const key = (qr << 16) | (qg << 8) | qb;
          let idx = paletteMap.get(key);
          if (idx === undefined) {
            if (palette.length / 3 >= 256) {
              // Palette full — find nearest existing entry
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

        // Pad palette to next power of 2 (min 4 entries for colorRes >= 1)
        let colorRes = 1;
        while ((1 << (colorRes + 1)) < Math.max(palette.length / 3, 4)) colorRes++;
        const palSize = 1 << (colorRes + 1);
        while (palette.length / 3 < palSize) palette.push(0, 0, 0);

        return { palette: new Uint8Array(palette), pixels, colorRes, transparentIdx, palSize };
      }

      // LZW compress
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
          if (table.has(next)) {
            cur = next;
          } else {
            writeCode(table.get(cur)!);
            if (nextCode < 4096) {
              table.set(next, nextCode++);
              if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
            } else {
              writeCode(clearCode);
              initTable();
            }
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
        blocks.push(0); // block terminator
        return new Uint8Array(blocks);
      }

      const parts: BlobPart[] = [];
      function push(...arrays: Uint8Array[]) { for (const a of arrays) parts.push(a as unknown as BlobPart); }

      // Header
      push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])); // GIF89a

      // Logical Screen Descriptor (no GCT — each frame has its own LCT)
      const w = gw, h = gh;
      push(new Uint8Array([w & 0xff, w >> 8, h & 0xff, h >> 8, 0x00, 0x00, 0x00]));

      // Netscape looping extension (loop forever)
      push(new Uint8Array([0x21, 0xff, 0x0b,
        0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // NETSCAPE2.0
        0x03, 0x01, 0x00, 0x00, 0x00]));

      for (const frame of frames) {
        try {
          const img = await loadImg(frame.image_b64);
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
        } catch {
          ctx.fillStyle = "#333";
          ctx.fillRect(0, 0, w, h);
        }
        const imageData = ctx.getImageData(0, 0, w, h);

        const { palette, pixels, colorRes, transparentIdx, palSize } = quantise(imageData);

        const delay = Math.round(frame.duration_ms / 10); // GIF delay is in 1/100ths of a second
        // Graphic Control Extension
        const hasTransp = transparentIdx >= 0;
        const packed = (hasTransp ? 0x01 : 0x00) | 0x08; // dispose = restore to bg
        push(new Uint8Array([
          0x21, 0xf9, 0x04, packed,
          delay & 0xff, delay >> 8,
          hasTransp ? transparentIdx : 0x00,
          0x00,
        ]));

        // Image Descriptor with Local Color Table
        const lctFlag = 0x80 | colorRes;
        push(new Uint8Array([
          0x2c,
          0x00, 0x00, 0x00, 0x00, // left, top
          w & 0xff, w >> 8, h & 0xff, h >> 8,
          lctFlag,
        ]));
        push(palette);

        // Image data (LZW)
        const minCodeSize = colorRes + 1;
        push(new Uint8Array([minCodeSize]));
        push(subBlock(lzwEncode(pixels, minCodeSize)));
      }

      // Trailer
      push(new Uint8Array([0x3b]));

      return new Blob(parts, { type: "image/gif" });
    },
    [frames],
  );

  const exportGif = useCallback(async () => {
    if (frames.length === 0) return;
    onNotify?.("Encoding GIF…", "info");
    try {
      const blob = await buildGif(frameW, frameH);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "animation.gif";
      a.click();
      URL.revokeObjectURL(url);
      onNotify?.("GIF exported", "success");
    } catch (e) {
      onNotify?.(`GIF export failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }, [frames, frameW, frameH, buildGif, onNotify]);

  // Export video — records a visible canvas via MediaRecorder (most reliable approach)
  const exportVideo = useCallback(async () => {
    if (frames.length === 0) return;

    const images = await Promise.all(
      frames.map((f) => loadImg(f.image_b64).catch(() => null)),
    );

    // Show a recording overlay with a visible canvas so captureStream actually works
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;";
    const label = document.createElement("div");
    label.textContent = "Recording video…";
    label.style.cssText = "color:#fff;font-size:14px;font-family:system-ui;";
    overlay.appendChild(label);

    const recCanvas = document.createElement("canvas");
    recCanvas.width = frameW;
    recCanvas.height = frameH;
    recCanvas.style.cssText = "max-width:60%;max-height:50%;border:1px solid #555;border-radius:4px;";
    overlay.appendChild(recCanvas);
    document.body.appendChild(overlay);

    const ctx = recCanvas.getContext("2d")!;

    try {
      const stream = recCanvas.captureStream();
      let mimeType = "";
      for (const mt of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
        if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
      }
      if (!mimeType) { onNotify?.("No video format supported", "error"); return; }

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const drawAt = (idx: number) => {
        const img = images[idx];
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, frameW, frameH);
        if (img) ctx.drawImage(img, 0, 0, frameW, frameH);
      };

      const schedule: number[] = [];
      let cum = 0;
      for (const f of frames) { cum += f.duration_ms; schedule.push(cum); }

      drawAt(0);
      recorder.start();

      // Animate with requestAnimationFrame — canvas is visible so rAF fires reliably
      await new Promise<void>((resolve) => {
        const t0 = performance.now();
        function tick() {
          const elapsed = performance.now() - t0;
          if (elapsed >= cum + 500) { resolve(); return; }
          let idx = 0;
          while (idx < schedule.length - 1 && elapsed >= schedule[idx]) idx++;
          drawAt(Math.min(idx, images.length - 1));
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });

      recorder.stop();
      await new Promise<void>((r) => { recorder.onstop = () => r(); });

      const blob = new Blob(chunks, { type: "video/webm" });
      if (blob.size < 500) {
        onNotify?.("Recording produced empty file", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "animation.webm";
      a.click();
      URL.revokeObjectURL(url);
      onNotify?.(`Video exported (${(blob.size / 1024).toFixed(0)} KB)`, "success");
    } catch (e) {
      onNotify?.(`Export failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      document.body.removeChild(overlay);
    }
  }, [frames, frameW, frameH, onNotify]);

  const exportSpriteSheet = useCallback(async () => {
    if (frames.length === 0) return;
    const cols = Math.ceil(Math.sqrt(frames.length));
    const rows = Math.ceil(frames.length / cols);
    const canvas = document.createElement("canvas");
    canvas.width = cols * frameW;
    canvas.height = rows * frameH;
    const ctx = canvas.getContext("2d")!;

    for (let i = 0; i < frames.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      try {
        const img = await loadImg(frames[i].image_b64);
        ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH);
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
  }, [frames, frameW, frameH, onNotify]);

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

  const currentFrame = hasFrames ? frames[currentIdx] : null;
  const hasAlts = currentFrame?.alternatives && currentFrame.alternatives.length > 0;
  const inputStyle: CSSProperties = {
    background: "var(--color-input-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
  };

  return (
    <div style={panelStyle}>
      {/* ── Editing Toolbar ── */}
      {hasFrames && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-card)",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => { setAdjustMode(!adjustMode); setShowRegenPanel(false); }}
            title="Image adjustments (brightness, contrast, saturation, hue)"
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors"
            style={{
              background: adjustMode ? "var(--color-accent)" : "var(--color-input-bg)",
              color: adjustMode ? "#fff" : "var(--color-text-secondary)",
              border: adjustMode ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
            }}
          >
            <Sliders className="h-3 w-3" /> Adjust
          </button>
          <button
            onClick={() => { setShowRegenPanel(!showRegenPanel); setAdjustMode(false); }}
            title="Regenerate this frame with options"
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors"
            style={{
              background: showRegenPanel ? "var(--color-accent)" : "var(--color-input-bg)",
              color: showRegenPanel ? "#fff" : "var(--color-text-secondary)",
              border: showRegenPanel ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
            }}
          >
            <RefreshCw className="h-3 w-3" /> Regenerate
          </button>
          <div className="w-px h-4 mx-1" style={{ background: "var(--color-border)" }} />
          <button
            onClick={handleUndo}
            disabled={editHistory.length === 0}
            title={`Undo (${editHistory.length} in history) — Ctrl+Z`}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors disabled:opacity-30"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}
          >
            <Undo2 className="h-3 w-3" /> Undo{editHistory.length > 0 ? ` (${editHistory.length})` : ""}
          </button>
        </div>
      )}

      {/* ── Adjustment Sliders ── */}
      {adjustMode && hasFrames && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-secondary)",
            flexWrap: "wrap",
          }}
        >
          {([
            { label: "Brightness", value: brightness, set: setBrightness, icon: <SunMedium className="h-3 w-3" /> },
            { label: "Contrast", value: contrast, set: setContrast, icon: <Contrast className="h-3 w-3" /> },
            { label: "Saturation", value: saturation, set: setSaturation, icon: <Droplets className="h-3 w-3" /> },
            { label: "Hue", value: hueRotation, set: setHueRotation, icon: <RotateCw className="h-3 w-3" />, min: 0, max: 360 },
          ] as const).map((s) => (
            <label key={s.label} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {s.icon}
              {s.label}
              <input
                type="range"
                min={("min" in s) ? s.min : -100}
                max={("max" in s) ? s.max : 100}
                value={s.value}
                onChange={(e) => s.set(Number(e.target.value))}
                className="w-16 h-3"
              />
              <span className="w-7 text-right tabular-nums" style={{ color: "var(--color-text-secondary)" }}>{s.value}</span>
            </label>
          ))}
          <button
            onClick={applyAdjustment}
            className="px-2 py-0.5 rounded text-[10px] font-medium"
            style={{ background: "var(--color-accent)", color: "#fff", border: "none" }}
          >
            Apply
          </button>
          <button
            onClick={resetAdjust}
            className="px-2 py-0.5 rounded text-[10px]"
            style={{ background: "var(--color-input-bg)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
          >
            Reset
          </button>
        </div>
      )}

      {/* ── Regeneration Panel ── */}
      {showRegenPanel && hasFrames && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-secondary)",
            flexWrap: "wrap",
          }}
        >
          <label className="flex items-center gap-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            Model
            <select
              value={regenModelId}
              onChange={(e) => setRegenModelId(e.target.value)}
              className="px-1.5 py-0.5 text-[10px] rounded"
              style={inputStyle}
            >
              <option value="">Default</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            Count
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setRegenCount(n)}
                  className="px-1.5 py-0.5 text-[10px] rounded font-medium"
                  style={{
                    background: regenCount === n ? "var(--color-accent)" : "var(--color-input-bg)",
                    color: regenCount === n ? "#fff" : "var(--color-text-secondary)",
                    border: regenCount === n ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>
          <input
            type="text"
            placeholder="Notes (optional)…"
            value={regenNotes}
            onChange={(e) => setRegenNotes(e.target.value)}
            className="flex-1 min-w-[100px] px-2 py-0.5 text-[10px] rounded"
            style={inputStyle}
          />
          <button
            onClick={handleRegenerate}
            disabled={regenerating || !currentFrame}
            className="px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-40"
            style={{ background: "var(--color-accent)", color: "#fff", border: "none" }}
          >
            {regenerating ? "Regenerating…" : `Regenerate Frame ${currentIdx + 1}`}
          </button>
        </div>
      )}

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
            width={frameW}
            height={frameH}
            style={{
              imageRendering: "pixelated",
              maxWidth: "100%",
              maxHeight: "100%",
              width: "auto",
              height: "auto",
              aspectRatio: `${frameW} / ${frameH}`,
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
        {frames.map((f, idx) => {
          const fHasAlts = f.alternatives && f.alternatives.length > 0;
          return (
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
              className="group"
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
              {/* Alternative arrows */}
              {fHasAlts && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); cycleAlternative(idx, -1); }}
                    className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)", borderRadius: "0 3px 3px 0", padding: "2px 1px", border: "none", color: "#fff", cursor: "pointer" }}
                  >
                    <ChevronLeft size={10} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); cycleAlternative(idx, 1); }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)", borderRadius: "3px 0 0 3px", padding: "2px 1px", border: "none", color: "#fff", cursor: "pointer" }}
                  >
                    <ChevronRight size={10} />
                  </button>
                  <span
                    style={{
                      position: "absolute",
                      top: 1,
                      left: 2,
                      fontSize: 8,
                      background: "var(--color-accent)",
                      color: "#fff",
                      padding: "0 3px",
                      borderRadius: 2,
                      lineHeight: "12px",
                    }}
                  >
                    {(f.activeAltIdx ?? 0) + 1}/{1 + f.alternatives!.length}
                  </span>
                </>
              )}
            </div>
          );
        })}
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
              action: () => {
                setCurrentIdx(contextMenu.idx);
                setShowRegenPanel(true);
                setAdjustMode(false);
              },
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
          All frames:
          <input
            type="number"
            min={1}
            max={2000}
            step={1}
            value={globalDuration}
            onChange={(e) => {
              const ms = Math.max(1, Math.min(2000, Number(e.target.value) || 100));
              setGlobalDuration(ms);
              if (hasFrames) onFramesChange(frames.map((f) => ({ ...f, duration_ms: ms })));
            }}
            className="ml-1 w-14 rounded px-1 py-0.5 text-xs"
            style={{
              background: "var(--color-input-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <span style={{ marginLeft: 3 }}>ms</span>
        </label>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {hasFrames ? `${(1000 / globalDuration).toFixed(1)} fps` : ""}
        </span>
        {/* FPS presets */}
        <div style={{ display: "flex", gap: 3 }}>
          {[{label:"8",ms:125},{label:"12",ms:83},{label:"24",ms:42},{label:"30",ms:33},{label:"60",ms:17}].map((p) => (
            <button
              key={p.label}
              disabled={!hasFrames}
              onClick={() => {
                setGlobalDuration(p.ms);
                onFramesChange(frames.map((f) => ({ ...f, duration_ms: p.ms })));
              }}
              className="px-1.5 py-0.5 rounded text-[9px] disabled:opacity-30"
              style={{
                background: globalDuration === p.ms ? "var(--color-accent)" : "var(--color-input-bg)",
                border: "1px solid var(--color-border)",
                color: globalDuration === p.ms ? "#fff" : "var(--color-text-muted)",
                cursor: hasFrames ? "pointer" : "default",
              }}
            >
              {p.label}fps
            </button>
          ))}
        </div>

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
              min={1}
              max={2000}
              step={1}
              value={frames[currentIdx]?.duration_ms ?? 100}
              onChange={(e) =>
                setFrameDuration(
                  currentIdx,
                  Math.max(1, Number(e.target.value) || 100),
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
            onClick={exportGif}
            disabled={!hasFrames}
            title="Export animated GIF (plays everywhere)"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-white/10 disabled:opacity-30"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <Download size={12} /> GIF
          </button>
          <button
            onClick={() => exportVideo()}
            disabled={!hasFrames}
            title="Export WebM video"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-white/10 disabled:opacity-30"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <Download size={12} /> Video
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
