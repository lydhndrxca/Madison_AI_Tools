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
  Maximize2,
  ZoomIn,
  ZoomOut,
  RefreshCw,
} from "lucide-react";
import {
  renderUvAtlas,
  applyTexture,
  type UvAtlasResult,
} from "@/lib/workshopApi";
import { apiFetch } from "@/hooks/useApi";
import type { MaterialSlotInfo } from "@/lib/workshopTypes";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";

type Tool = "brush" | "eraser";

interface LocalAtlas {
  atlas_b64: string;
  wireframe_b64: string | null;
  width: number;
  height: number;
  was_unwrapped?: boolean;
}

export interface UVAtlasEditorProps {
  projectId: string | null;
  versionId?: string;
  modelUrl?: string | null;
  materialSlots: MaterialSlotInfo[];
  onVersionCreated?: () => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const INPAINT_MAX_DIM = 1024;
const DEFAULT_RES = 2048;

/* ── Client-side GLB texture + wireframe extraction ─────── */

function extractAtlasFromGLTF(
  gltf: THREE.Group,
  materialIndex: number,
  resolution: number,
): LocalAtlas | null {
  const allMats: THREE.Material[] = [];
  gltf.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (m && !allMats.includes(m)) allMats.push(m);
    }
  });

  const targetMat = allMats[materialIndex] ?? allMats[0];
  if (!targetMat) return null;

  // Extract base color texture
  let atlasB64: string | null = null;
  let texW = resolution;
  let texH = resolution;
  let hasTextureMap = false;

  const matAny = targetMat as THREE.MeshStandardMaterial & { map?: THREE.Texture | null; color?: THREE.Color };
  const map = matAny.map;
  if (map?.image) {
    const img = map.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    texW = img.width;
    texH = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    atlasB64 = c.toDataURL("image/png").split(",")[1];
    hasTextureMap = true;
  }

  // Helper: get CSS color string from a material
  const getMaterialColor = (mat: THREE.Material): string => {
    const m = mat as THREE.MeshStandardMaterial & { color?: THREE.Color };
    if (m.color) return `#${m.color.getHexString()}`;
    return "#888";
  };

  // If no texture, render color-filled UV triangles per-mesh so user can identify parts
  if (!atlasB64) {
    texW = resolution;
    texH = resolution;
    const c = document.createElement("canvas");
    c.width = texW;
    c.height = texH;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, texW, texH);

    // Distinct colors for each mesh that uses this material
    const meshColors = [
      "rgba(230,190,160,0.9)", "rgba(120,120,130,0.9)", "rgba(180,210,180,0.9)",
      "rgba(200,170,210,0.9)", "rgba(210,200,160,0.9)", "rgba(160,195,220,0.9)",
    ];
    let meshIdx = 0;

    gltf.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const geo = child.geometry as THREE.BufferGeometry;
      const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute | null;
      if (!uvAttr) return;

      const index = geo.index;
      const vertCount = index ? index.count : uvAttr.count;
      const groups = geo.groups.length > 0
        ? geo.groups
        : [{ start: 0, count: vertCount, materialIndex: 0 }];

      let hasFaces = false;
      for (const group of groups) {
        const groupMat = mats[group.materialIndex ?? 0] ?? mats[0];
        if (groupMat !== targetMat) continue;

        // Use the actual material color or a per-mesh fallback
        const baseColor = getMaterialColor(groupMat);
        const fallbackColor = meshColors[meshIdx % meshColors.length];
        ctx.fillStyle = baseColor !== "#888" && baseColor !== "#000000" ? baseColor : fallbackColor;

        for (let i = group.start; i < group.start + group.count; i += 3) {
          const i0 = index ? index.getX(i) : i;
          const i1 = index ? index.getX(i + 1) : i + 1;
          const i2 = index ? index.getX(i + 2) : i + 2;

          const uvs = [i0, i1, i2].map((vi) => ({
            x: uvAttr.getX(vi) * texW,
            y: (1 - uvAttr.getY(vi)) * texH,
          }));

          ctx.beginPath();
          ctx.moveTo(uvs[0].x, uvs[0].y);
          ctx.lineTo(uvs[1].x, uvs[1].y);
          ctx.lineTo(uvs[2].x, uvs[2].y);
          ctx.closePath();
          ctx.fill();
          hasFaces = true;
        }
      }
      if (hasFaces) meshIdx++;
    });

    atlasB64 = c.toDataURL("image/png").split(",")[1];
  }

  // Draw UV wireframe
  const wireCanvas = document.createElement("canvas");
  wireCanvas.width = texW;
  wireCanvas.height = texH;
  const wCtx = wireCanvas.getContext("2d")!;
  wCtx.clearRect(0, 0, texW, texH);
  wCtx.strokeStyle = hasTextureMap ? "rgba(255, 153, 0, 0.8)" : "rgba(255, 255, 255, 0.3)";
  wCtx.lineWidth = 1;

  gltf.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const geo = child.geometry as THREE.BufferGeometry;
    const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute | null;
    if (!uvAttr) return;

    const index = geo.index;
    const vertCount = index ? index.count : uvAttr.count;
    const groups = geo.groups.length > 0
      ? geo.groups
      : [{ start: 0, count: vertCount, materialIndex: 0 }];

    for (const group of groups) {
      const groupMat = mats[group.materialIndex ?? 0] ?? mats[0];
      if (groupMat !== targetMat) continue;

      for (let i = group.start; i < group.start + group.count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;

        const uvs = [i0, i1, i2].map((vi) => ({
          x: uvAttr.getX(vi) * texW,
          y: (1 - uvAttr.getY(vi)) * texH,
        }));

        wCtx.beginPath();
        wCtx.moveTo(uvs[0].x, uvs[0].y);
        wCtx.lineTo(uvs[1].x, uvs[1].y);
        wCtx.lineTo(uvs[2].x, uvs[2].y);
        wCtx.closePath();
        wCtx.stroke();
      }
    }
  });

  const wireB64 = wireCanvas.toDataURL("image/png").split(",")[1];

  return {
    atlas_b64: atlasB64,
    wireframe_b64: wireB64,
    width: texW,
    height: texH,
  };
}

function getModelFormat(url: string): "gltf" | "fbx" | "obj" | "unknown" {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".glb") || clean.endsWith(".gltf")) return "gltf";
  if (clean.endsWith(".fbx")) return "fbx";
  if (clean.endsWith(".obj")) return "obj";
  return "unknown";
}

async function loadModelScene(url: string): Promise<THREE.Group> {
  const fmt = getModelFormat(url);

  if (fmt === "fbx") {
    return new Promise((resolve, reject) => {
      new FBXLoader().load(url, (group) => resolve(group), undefined, reject);
    });
  }

  if (fmt === "obj") {
    const baseUrl = url.substring(0, url.lastIndexOf("/") + 1);
    const mtlUrl = url.replace(/\.obj$/i, ".mtl");

    try {
      const materials = await new Promise<MTLLoader.MaterialCreator>((resolve, reject) => {
        new MTLLoader().setPath(baseUrl).load(
          mtlUrl.substring(mtlUrl.lastIndexOf("/") + 1),
          resolve, undefined, reject,
        );
      });
      materials.preload();
      return new Promise((resolve, reject) => {
        new OBJLoader().setMaterials(materials).load(url, resolve, undefined, reject);
      });
    } catch {
      return new Promise((resolve, reject) => {
        new OBJLoader().load(url, resolve, undefined, reject);
      });
    }
  }

  // Default: GLTF/GLB (also handles unknown — the workshop converts everything to GLB)
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

/* ── Component ────────────────────────────────────────────── */

export function UVAtlasEditor({
  projectId,
  versionId,
  modelUrl,
  materialSlots,
  onVersionCreated,
}: UVAtlasEditorProps) {
  const [slotIndex, setSlotIndex] = useState(0);
  const [atlas, setAtlas] = useState<LocalAtlas | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(20);
  const [prompt, setPrompt] = useState("");
  const [inpaintResult, setInpaintResult] = useState<string | null>(null);
  const [showWireframe, setShowWireframe] = useState(true);
  const [smartUnwrap, setSmartUnwrap] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const spaceDown = useRef(false);

  const cachedKeyRef = useRef<string | null>(null);
  const gltfCacheRef = useRef<{ url: string; scene: THREE.Group } | null>(null);

  /* ── Load atlas: client-side (fast) or Blender (smart unwrap) ── */

  const loadAtlas = useCallback(async (force = false) => {
    if (!projectId) return;
    const cacheKey = `${projectId}|${versionId ?? ""}|${slotIndex}|${smartUnwrap}|${modelUrl ?? ""}`;
    if (!force && cachedKeyRef.current === cacheKey && atlas) return;
    setLoading(true);
    setError(null);
    setInpaintResult(null);

    try {
      if (smartUnwrap) {
        // Smart re-unwrap requires Blender
        const result = await renderUvAtlas(projectId, versionId, slotIndex, DEFAULT_RES, true);
        setAtlas(result);
      } else if (modelUrl) {
        // Fast client-side extraction
        let scene: THREE.Group;
        if (gltfCacheRef.current?.url === modelUrl) {
          scene = gltfCacheRef.current.scene;
        } else {
          scene = await loadModelScene(modelUrl);
          gltfCacheRef.current = { url: modelUrl, scene };
        }
        const result = extractAtlasFromGLTF(scene, slotIndex, DEFAULT_RES);
        if (!result) throw new Error("No materials found in model");
        setAtlas(result);
      } else {
        // Fallback to Blender
        const result = await renderUvAtlas(projectId, versionId, slotIndex, DEFAULT_RES, false);
        setAtlas(result);
      }
      cachedKeyRef.current = cacheKey;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load UV atlas");
    } finally {
      setLoading(false);
    }
  }, [projectId, versionId, slotIndex, smartUnwrap, modelUrl, atlas]);

  // Auto-load when modelUrl is available (instant now, no Blender)
  useEffect(() => {
    if (modelUrl && !smartUnwrap && !atlas) loadAtlas();
  }, [modelUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!projectId) { setAtlas(null); cachedKeyRef.current = null; }
  }, [projectId]);

  /* ── Draw atlas onto canvas ──────────────────────────────── */

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

  /* ── Fit zoom on load ────────────────────────────────────── */

  const fitView = useCallback(() => {
    if (!atlas || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / atlas.width;
    const scaleY = rect.height / atlas.height;
    const fit = Math.min(scaleX, scaleY) * 0.95;
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fit)));
    setPan({ x: 0, y: 0 });
  }, [atlas]);

  useEffect(() => { fitView(); }, [fitView]);

  /* ── Pointer → canvas coords (accounting for zoom+pan) ─── */

  const pointerToCanvas = useCallback((e: React.PointerEvent | PointerEvent) => {
    if (!maskCanvasRef.current || !containerRef.current || !atlas) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - containerRect.left - containerRect.width / 2 - pan.x;
    const cy = e.clientY - containerRect.top - containerRect.height / 2 - pan.y;
    const x = cx / zoom + atlas.width / 2;
    const y = cy / zoom + atlas.height / 2;
    return { x, y };
  }, [atlas, zoom, pan]);

  /* ── Drawing ─────────────────────────────────────────────── */

  const scaledBrush = useMemo(
    () => brushSize * ((atlas?.width ?? 2048) / 512),
    [brushSize, atlas],
  );

  const drawDot = useCallback((x: number, y: number) => {
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (!maskCtx) return;
    maskCtx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    maskCtx.fillStyle = "rgba(0, 255, 0, 0.85)";
    maskCtx.beginPath();
    maskCtx.arc(x, y, scaledBrush / 2, 0, Math.PI * 2);
    maskCtx.fill();
  }, [tool, scaledBrush]);

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (!maskCtx) return;
    maskCtx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    maskCtx.strokeStyle = "rgba(0, 255, 0, 0.85)";
    maskCtx.lineWidth = scaledBrush;
    maskCtx.lineCap = "round";
    maskCtx.beginPath();
    maskCtx.moveTo(from.x, from.y);
    maskCtx.lineTo(to.x, to.y);
    maskCtx.stroke();
  }, [tool, scaledBrush]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (spaceDown.current || e.button === 1) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pos = pointerToCanvas(e);
    if (!pos) return;
    isDrawing.current = true;
    lastPos.current = pos;
    drawDot(pos.x, pos.y);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pointerToCanvas, drawDot, pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isPanning.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (!isDrawing.current) return;
    const pos = pointerToCanvas(e);
    if (!pos) return;
    if (lastPos.current) drawLine(lastPos.current, pos);
    lastPos.current = pos;
  }, [pointerToCanvas, drawLine]);

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false;
    lastPos.current = null;
    isPanning.current = false;
  }, []);

  /* ── Wheel zoom ──────────────────────────────────────────── */

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)));
  }, []);

  /* ── Space key for pan mode ──────────────────────────────── */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space" && !e.repeat) { spaceDown.current = true; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  /* ── Clear mask ──────────────────────────────────────────── */

  const clearMask = useCallback(() => {
    const maskCtx = maskCanvasRef.current?.getContext("2d");
    if (maskCtx && atlas) {
      maskCtx.clearRect(0, 0, atlas.width, atlas.height);
    }
  }, [atlas]);

  /* ── Inpaint (downscale for Gemini) ──────────────────────── */

  const handleInpaint = useCallback(async () => {
    if (!atlas || !canvasRef.current || !maskCanvasRef.current || !prompt.trim()) return;
    setApplying(true);
    setError(null);

    try {
      const srcW = atlas.width;
      const srcH = atlas.height;
      const scale = Math.min(1, INPAINT_MAX_DIM / Math.max(srcW, srcH));
      const outW = Math.round(srcW * scale);
      const outH = Math.round(srcH * scale);

      const atlasImg = new Image();
      await new Promise<void>((resolve, reject) => {
        atlasImg.onload = () => resolve();
        atlasImg.onerror = reject;
        atlasImg.src = inpaintResult
          ? `data:image/png;base64,${inpaintResult}`
          : `data:image/png;base64,${atlas.atlas_b64}`;
      });

      const origCanvas = document.createElement("canvas");
      origCanvas.width = outW;
      origCanvas.height = outH;
      const origCtx = origCanvas.getContext("2d")!;
      origCtx.drawImage(atlasImg, 0, 0, outW, outH);
      const atlasB64 = origCanvas.toDataURL("image/png").split(",")[1];

      const compCanvas = document.createElement("canvas");
      compCanvas.width = outW;
      compCanvas.height = outH;
      const compCtx = compCanvas.getContext("2d")!;
      compCtx.drawImage(atlasImg, 0, 0, outW, outH);
      compCtx.drawImage(maskCanvasRef.current, 0, 0, outW, outH);
      const compositeB64 = compCanvas.toDataURL("image/png").split(",")[1];

      const bwCanvas = document.createElement("canvas");
      bwCanvas.width = outW;
      bwCanvas.height = outH;
      const bwCtx = bwCanvas.getContext("2d")!;
      bwCtx.fillStyle = "#000";
      bwCtx.fillRect(0, 0, outW, outH);
      bwCtx.drawImage(maskCanvasRef.current, 0, 0, outW, outH);
      const bwData = bwCtx.getImageData(0, 0, outW, outH);
      for (let i = 0; i < bwData.data.length; i += 4) {
        const hasGreen = bwData.data[i + 1] > 100 && bwData.data[i + 3] > 30;
        bwData.data[i] = hasGreen ? 255 : 0;
        bwData.data[i + 1] = hasGreen ? 255 : 0;
        bwData.data[i + 2] = hasGreen ? 255 : 0;
        bwData.data[i + 3] = 255;
      }
      bwCtx.putImageData(bwData, 0, 0);
      const maskB64 = bwCanvas.toDataURL("image/png").split(",")[1];

      const result = await apiFetch<{ image_b64?: string; error?: string }>("/editor/inpaint", {
        method: "POST",
        body: JSON.stringify({
          image_b64: atlasB64,
          mask_composite_b64: compositeB64,
          mask_b64: maskB64,
          prompt: prompt.trim(),
          context_hint: "uv_texture",
        }),
      });

      if (result.error) throw new Error(result.error);
      if (result.image_b64) {
        setInpaintResult(result.image_b64);
        clearMask();
      } else {
        throw new Error("Inpaint returned no image");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Inpaint failed");
    } finally {
      setApplying(false);
    }
  }, [atlas, prompt, inpaintResult, clearMask]);

  /* ── Apply to model ──────────────────────────────────────── */

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

  /* ── Render ──────────────────────────────────────────────── */

  const canvasStyle = useMemo(() => {
    if (!atlas) return {};
    const w = atlas.width * zoom;
    const h = atlas.height * zoom;
    return { width: w, height: h };
  }, [atlas, zoom]);

  return (
    <div className="flex flex-col w-full h-full min-h-0 flex-1">
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

        <ToolButton active={tool === "brush"} onClick={() => setTool("brush")} title="Brush (left-click to paint)">
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

        <div className="w-px h-4" style={{ background: "rgba(255,255,255,0.08)" }} />

        <ToolButton active={false} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.3))} title="Zoom In">
          <ZoomIn className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={false} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.3))} title="Zoom Out">
          <ZoomOut className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={false} onClick={fitView} title="Fit to View">
          <Maximize2 className="h-3 w-3" />
        </ToolButton>
        <span className="text-[9px] w-8 text-center" style={{ color: "var(--color-text-muted)" }}>
          {Math.round(zoom * 100)}%
        </span>

        <div className="w-px h-4" style={{ background: "rgba(255,255,255,0.08)" }} />

        <label className="flex items-center gap-1 text-[9px] cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
          <input
            type="checkbox"
            checked={showWireframe}
            onChange={(e) => setShowWireframe(e.target.checked)}
            className="accent-purple-500"
          />
          Wire
        </label>
        <label
          className="flex items-center gap-1 text-[9px] cursor-pointer"
          style={{ color: smartUnwrap ? "#a78bfa" : "var(--color-text-muted)" }}
          title="Re-unwrap UVs with Smart UV Project via Blender (slower, clean islands for painting)"
        >
          <input
            type="checkbox"
            checked={smartUnwrap}
            onChange={(e) => setSmartUnwrap(e.target.checked)}
            className="accent-purple-500"
          />
          Re-UV
        </label>

        <button
          type="button"
          onClick={() => loadAtlas(true)}
          disabled={loading || !projectId}
          className="p-1 rounded"
          style={{ color: "var(--color-text-muted)" }}
          title={smartUnwrap ? "Re-render UV atlas via Blender" : "Refresh atlas from model"}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
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

      {/* Canvas area with zoom/pan */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden"
        style={{ background: "rgba(0,0,0,0.3)", cursor: spaceDown.current || isPanning.current ? "grab" : "crosshair" }}
        onWheel={handleWheel}
      >
        {loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--color-text-muted)" }} />
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {smartUnwrap ? "Re-unwrapping UVs in Blender..." : "Loading UV atlas..."}
            </span>
          </div>
        ) : atlas ? (
          <div
            className="absolute"
            style={{
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
              ...canvasStyle,
            }}
          >
            <canvas
              ref={canvasRef}
              className="block"
              style={{ width: "100%", height: "100%", imageRendering: zoom > 2 ? "pixelated" : "auto" }}
            />
            <canvas
              ref={maskCanvasRef}
              className="absolute top-0 left-0"
              style={{
                width: "100%",
                height: "100%",
                pointerEvents: "auto",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Square className="h-6 w-6" style={{ color: "var(--color-text-muted)" }} />
            <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {projectId && modelUrl
                ? "Switch to the UV Editor tab to load"
                : projectId
                  ? "Load a model first"
                  : "Open a project first"}
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
