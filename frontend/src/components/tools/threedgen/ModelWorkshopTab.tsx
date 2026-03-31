import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  Environment,
  Grid,
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  TransformControls,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  ModelWorkshopProvider,
  useModelWorkshop,
  type EditorTool,
} from "./ModelWorkshopContext";
import ModelWorkshopFFD from "./ModelWorkshopFFD";
import ModelWorkshopRefBlocks from "./ModelWorkshopRefBlocks";
import type { ThreeDJob } from "@/lib/threedgenApi";
import {
  MousePointer2,
  Move,
  RotateCw,
  Maximize2,
  Grid3x3,
  Layers,
  Triangle,
  Box,
  Undo2,
  Redo2,
  Loader2,
  ChevronDown,
  Upload,
  RotateCcw,
  Crosshair,
  Magnet,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  Minus,
  Plus,
  ImageIcon,
  X,
} from "lucide-react";
import { useToastContext } from "@/hooks/ToastContext";
import { uploadModel, getModelUrl } from "@/lib/workshopApi";

interface TextureMap {
  diffuse?: string;
  normal?: string;
  roughness?: string;
  metalness?: string;
  ao?: string;
  emissive?: string;
}

const TEXTURE_CHANNELS: { key: keyof TextureMap; label: string }[] = [
  { key: "diffuse", label: "Diffuse / Color" },
  { key: "normal", label: "Normal" },
  { key: "roughness", label: "Roughness" },
  { key: "metalness", label: "Metalness" },
  { key: "ao", label: "Ambient Occlusion" },
  { key: "emissive", label: "Emissive" },
];

/* ── Types ─────────────────────────────────────────────────── */

export interface ModelWorkshopTabProps {
  succeededJobs: ThreeDJob[];
  initialModelUrl?: string | null;
  initialJobId?: string | null;
  onLoadModel: (job: ThreeDJob) => Promise<string>;
}

/* ── Number input for properties ── */

function NumInput({ label, value, color, onChange, step = 0.01 }: {
  label: string; value: number; color: string; onChange: (v: number) => void; step?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: "uppercase" }}>{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%", padding: "3px 6px", fontSize: 11, fontFamily: "monospace",
          background: "var(--color-input-bg)", border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)", borderRadius: 4, textAlign: "center",
        }}
      />
    </div>
  );
}

/* ── Collapsible section ── */

function Section({ title, children, defaultCollapsed = false }: {
  title: string; children: React.ReactNode; defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div style={{ borderBottom: "1px solid var(--color-border)" }}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        style={{
          width: "100%", padding: "6px 8px", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "transparent", border: "none", color: "var(--color-text-secondary)",
          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
        }}
      >
        {title}
        <span style={{ fontSize: 9, opacity: 0.6 }}>{collapsed ? "\u25B8" : "\u25BE"}</span>
      </button>
      {!collapsed && <div style={{ padding: "0 8px 8px" }}>{children}</div>}
    </div>
  );
}

/* ── Camera Capture ── */

function CameraCapture() {
  const { camera } = useThree();
  const { state } = useModelWorkshop();
  useEffect(() => {
    (state.cameraRef as React.MutableRefObject<THREE.Camera | null>).current = camera;
  }, [camera, state.cameraRef]);
  return null;
}

function detectModelFormat(url: string): "glb" | "fbx" | "obj" | "gltf" {
  const lower = url.toLowerCase();
  const hash = lower.split("#").pop() ?? "";
  if (hash.endsWith(".fbx") || lower.replace(/[?#].*$/, "").endsWith(".fbx")) return "fbx";
  if (hash.endsWith(".obj") || lower.replace(/[?#].*$/, "").endsWith(".obj")) return "obj";
  if (hash.endsWith(".gltf") || lower.replace(/[?#].*$/, "").endsWith(".gltf")) return "gltf";
  return "glb";
}

function WorkshopGLTFScene({ url, onScene }: { url: string; onScene: (s: THREE.Group) => void }) {
  const cleanUrl = url.split("#")[0];
  const { scene } = useGLTF(cleanUrl);
  useEffect(() => {
    autoFitModel(scene);
    onScene(scene);
  }, [scene, onScene]);
  return null;
}

function buildTextureMaps(tex: TextureMap): Partial<Record<string, THREE.Texture>> {
  const loader = new THREE.TextureLoader();
  const load = (url?: string) => url ? loader.load(url) : undefined;
  const maps: Partial<Record<string, THREE.Texture>> = {};
  if (tex.diffuse) maps.map = load(tex.diffuse);
  if (tex.normal) maps.normalMap = load(tex.normal);
  if (tex.roughness) maps.roughnessMap = load(tex.roughness);
  if (tex.metalness) maps.metalnessMap = load(tex.metalness);
  if (tex.ao) maps.aoMap = load(tex.ao);
  if (tex.emissive) maps.emissiveMap = load(tex.emissive);
  return maps;
}

function applyMapsToMesh(mesh: THREE.Mesh, maps: Partial<Record<string, THREE.Texture>>) {
  const mat = new THREE.MeshStandardMaterial();
  if (maps.map) mat.map = maps.map;
  if (maps.normalMap) mat.normalMap = maps.normalMap;
  if (maps.roughnessMap) mat.roughnessMap = maps.roughnessMap;
  if (maps.metalnessMap) { mat.metalnessMap = maps.metalnessMap; mat.metalness = 1; }
  if (maps.aoMap) mat.aoMap = maps.aoMap;
  if (maps.emissiveMap) { mat.emissiveMap = maps.emissiveMap; mat.emissive = new THREE.Color(1, 1, 1); }
  mat.needsUpdate = true;
  mesh.material = mat;
}

function applySlotTexturesToGroup(
  group: THREE.Group | THREE.Object3D,
  slotTextures: Record<number, TextureMap>,
  materialSlots: import("./ModelWorkshopContext").MaterialSlot[],
) {
  const slotUuids = new Map<string, number>();
  const allMats: THREE.Material[] = [];
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) if (!allMats.find((x) => x.uuid === m.uuid)) allMats.push(m);
  });
  materialSlots.forEach((slot) => {
    if (allMats[slot.index]) slotUuids.set(allMats[slot.index].uuid, slot.index);
  });

  const allTex = slotTextures[-1];
  const allMaps = allTex && Object.keys(allTex).length > 0 ? buildTextureMaps(allTex) : null;

  const slotMapsCache = new Map<number, Partial<Record<string, THREE.Texture>>>();
  for (const [idx, tex] of Object.entries(slotTextures)) {
    const i = Number(idx);
    if (i < 0) continue;
    if (Object.keys(tex).length > 0) slotMapsCache.set(i, buildTextureMaps(tex));
  }

  if (!allMaps && slotMapsCache.size === 0) return;

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      const slotIdx = slotUuids.get(mat.uuid);
      const maps = (slotIdx !== undefined && slotMapsCache.get(slotIdx)) || allMaps;
      if (maps && Object.keys(maps).length > 0) applyMapsToMesh(child, maps);
    }
  });
}

function stripGroundPlanes(group: THREE.Group) {
  const meshes: THREE.Mesh[] = [];
  const toRemove: THREE.Object3D[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child);
  });
  if (meshes.length <= 1) return;
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo) continue;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) continue;
    const s = new THREE.Vector3();
    bb.getSize(s);
    const dims = [s.x, s.y, s.z].sort((a, b) => a - b);
    const thin = dims[0];
    const wide = dims[2];
    if (wide > 0 && thin / wide < 0.005) {
      toRemove.push(mesh);
    }
  }
  if (toRemove.length >= meshes.length) return;
  for (const obj of toRemove) obj.removeFromParent();
}

function autoFitModel(group: THREE.Group) {
  try {
    stripGroundPlanes(group);

    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const TARGET = 2;
      const s = TARGET / maxDim;
      group.scale.multiplyScalar(s);
    }
    box.setFromObject(group);
    const center = new THREE.Vector3();
    box.getCenter(center);
    group.position.sub(center);
    group.position.y -= box.min.y - center.y;
  } catch (err) {
    console.warn("[autoFitModel] failed, using model as-is:", err);
  }
}

function WorkshopFBXOBJScene({ url, fmt, onScene }: { url: string; fmt: "fbx" | "obj"; onScene: (s: THREE.Group) => void }) {
  const cleanUrl = url.split("#")[0];
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const loader = fmt === "fbx" ? new FBXLoader() : new OBJLoader();
    loader.load(
      cleanUrl,
      (result) => {
        if (cancelled) return;
        const group = result as THREE.Group;
        autoFitModel(group);
        onScene(group);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        console.error(`[Workshop] ${fmt.toUpperCase()} load failed:`, err);
        setError(`Failed to load ${fmt.toUpperCase()} file: ${err instanceof Error ? err.message : err}`);
      },
    );
    return () => { cancelled = true; };
  }, [cleanUrl, fmt, onScene]);

  if (error) throw new Error(error);
  return null;
}

/* ── Model Scene ── */

function WorkshopModelScene({ url, slotTextures, materialSlots }: {
  url: string;
  slotTextures?: Record<number, TextureMap>;
  materialSlots?: import("./ModelWorkshopContext").MaterialSlot[];
}) {
  const { state, actions } = useModelWorkshop();
  const fmt = useMemo(() => detectModelFormat(url), [url]);
  const isGltf = fmt === "glb" || fmt === "gltf";
  const [rawScene, setRawScene] = useState<THREE.Group | null>(null);
  const onScene = useCallback((s: THREE.Group) => setRawScene(s), []);
  const clonedScene = useMemo(() => rawScene?.clone(true) ?? null, [rawScene]);

  useEffect(() => {
    if (!clonedScene || !slotTextures) return;
    const hasAny = Object.values(slotTextures).some((t) => Object.keys(t).length > 0);
    if (!hasAny) return;
    applySlotTexturesToGroup(clonedScene, slotTextures, materialSlots ?? []);
  }, [clonedScene, slotTextures, materialSlots]);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (groupRef.current) {
      (state.modelRef as React.MutableRefObject<THREE.Group | null>).current = groupRef.current;
      actions.notifyModelReady();

      const slots: import("./ModelWorkshopContext").MaterialSlot[] = [];
      const matMap = new Map<string, { index: number; name: string; meshNames: string[] }>();
      let idx = 0;
      groupRef.current.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          const key = mat.uuid;
          if (!matMap.has(key)) {
            matMap.set(key, { index: idx++, name: mat.name || `Material ${idx}`, meshNames: [] });
          }
          matMap.get(key)!.meshNames.push(child.name || "unnamed");
        }
      });
      matMap.forEach((v) => slots.push(v));
      actions.setMaterialSlots(slots);
    }
  }, [clonedScene, state.modelRef, actions]);

  useEffect(() => {
    if (!groupRef.current) return;
    const box = new THREE.Box3().setFromObject(groupRef.current);
    const size = new THREE.Vector3();
    box.getSize(size);
    actions.setModelBBox(box, size);
  }, [clonedScene, actions]);

  useLayoutEffect(() => {
    if (!clonedScene) return;
    clonedScene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (state.showNormals) {
        child.material = new THREE.MeshNormalMaterial({ wireframe: state.wireframe });
      } else {
        if (!child.userData._origMat) child.userData._origMat = child.material;
        if (state.wireframe) {
          child.material = new THREE.MeshBasicMaterial({ wireframe: true, color: 0x8899aa });
        } else {
          child.material = child.userData._origMat;
        }
      }
    });
  }, [clonedScene, state.wireframe, state.showNormals]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(state.position);
    groupRef.current.rotation.copy(state.rotation);
    groupRef.current.scale.copy(state.scale);
  }, [state.position, state.rotation, state.scale]);

  return (
    <>
      {isGltf ? (
        <WorkshopGLTFScene url={url} onScene={onScene} />
      ) : (
        <WorkshopFBXOBJScene url={url} fmt={fmt as "fbx" | "obj"} onScene={onScene} />
      )}
      {clonedScene && (
        <group ref={groupRef}>
          <primitive object={clonedScene} />
        </group>
      )}
    </>
  );
}

/* ── Transform Gizmo ── */

function WorkshopTransformGizmo() {
  const { state, actions } = useModelWorkshop();
  const transformRef = useRef<any>(null);
  const controls = useThree((s) => s.controls) as any;

  const showGizmo =
    state.modelReady > 0 &&
    state.modelRef.current &&
    (state.activeTool === "move" || state.activeTool === "rotate" || state.activeTool === "scale");

  useEffect(() => {
    if (!transformRef.current) return;
    const ctrl = transformRef.current;
    const handler = () => {
      if (!state.modelRef.current) return;
      const obj = state.modelRef.current;
      actions.setPosition(obj.position.clone());
      actions.setRotation(obj.rotation.clone());
      actions.setScale(obj.scale.clone());
    };
    ctrl.addEventListener("objectChange", handler);
    return () => ctrl.removeEventListener("objectChange", handler);
  }, [state.modelRef, state.modelReady, actions]);

  useEffect(() => {
    if (!transformRef.current) return;
    const ctrl = transformRef.current;
    const onDown = () => actions.pushUndo("Transform");
    ctrl.addEventListener("mouseDown", onDown);
    return () => ctrl.removeEventListener("mouseDown", onDown);
  }, [actions]);

  useEffect(() => {
    if (!transformRef.current || !controls) return;
    const ctrl = transformRef.current;
    const onDragging = (e: { value: boolean }) => {
      controls.enabled = !e.value;
    };
    ctrl.addEventListener("dragging-changed", onDragging);
    return () => {
      ctrl.removeEventListener("dragging-changed", onDragging);
      controls.enabled = true;
    };
  }, [controls, showGizmo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!showGizmo || !state.modelRef.current) return null;

  return (
    <TransformControls
      ref={transformRef}
      object={state.modelRef.current}
      mode={state.transformMode}
      translationSnap={state.gridSnap.enabled ? state.gridSnap.value / 100 : null}
      rotationSnap={state.rotateSnap.enabled ? (state.rotateSnap.value * Math.PI) / 180 : null}
      scaleSnap={state.scaleSnap.enabled ? state.scaleSnap.value / 100 : null}
    />
  );
}

/* ── Dynamic Grid ── */

function DynamicGrid() {
  const { state } = useModelWorkshop();
  const snap = state.gridSnap;
  return (
    <Grid
      infiniteGrid
      fadeDistance={45}
      fadeStrength={1}
      position={[0, -0.002, 0]}
      cellSize={snap.enabled ? snap.value / 100 : 0.5}
      cellThickness={0.6}
      sectionSize={snap.enabled ? (snap.value / 100) * 5 : 3}
      sectionThickness={1}
      sectionColor={snap.enabled ? "#4db6ac" : "#5a5a62"}
      cellColor={snap.enabled ? "#1a3330" : "#3d3d44"}
    />
  );
}

/* ── FFD Orbit Guard ── */

function FFDOrbitGuard() {
  const { state } = useModelWorkshop();
  const controls = useThree((s) => s.controls) as any;

  useEffect(() => {
    if (!state.ffd.enabled || !controls) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Shift") controls.enabled = false; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Shift") controls.enabled = true; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      controls.enabled = true;
    };
  }, [state.ffd.enabled, controls]);

  return null;
}

/* ── Keyboard Shortcuts ── */

function KeyboardHandler() {
  const { state, actions } = useModelWorkshop();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl && key === "z" && !e.shiftKey) { e.preventDefault(); actions.undo(); return; }
      if ((ctrl && key === "z" && e.shiftKey) || (ctrl && key === "y")) { e.preventDefault(); actions.redo(); return; }

      switch (key) {
        case "q": actions.setActiveTool("select"); break;
        case "w": actions.setActiveTool("move"); break;
        case "e": actions.setActiveTool("rotate"); break;
        case "r": actions.setActiveTool("scale"); break;
        case "f": actions.setFFDEnabled(!state.ffd.enabled); break;
        case "b": actions.snapPivotToBottom(); break;
        case "c": if (!ctrl) actions.centerToOrigin(); break;
        case "g": actions.setGridSnap({ enabled: !state.gridSnap.enabled }); break;
        case "n": actions.setShowNormals(!state.showNormals); break;
        case "escape":
          if (state.selectedBlockId) actions.setSelectedBlock(null);
          else if (state.ffd.selectedPointIndices.length > 0) actions.setFFDSelectedPoints([]);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, actions]);

  return null;
}

/* ── Toolbar button helper ── */

const TOOL_ITEMS: { tool: EditorTool; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select", shortcut: "Q" },
  { tool: "move", icon: Move, label: "Move", shortcut: "W" },
  { tool: "rotate", icon: RotateCw, label: "Rotate", shortcut: "E" },
  { tool: "scale", icon: Maximize2, label: "Scale", shortcut: "R" },
  { tool: "ffd", icon: Grid3x3, label: "FFD", shortcut: "F" },
];

/* ── Properties Panel ── */

function PropertiesPanelInline() {
  const { state, actions } = useModelWorkshop();
  const pos = state.position;
  const rot = state.rotation;
  const scl = state.scale;
  const UU = 100;

  const setPos = useCallback((axis: "x" | "y" | "z", v: number) => {
    const p = pos.clone(); p[axis] = v; actions.setPosition(p);
  }, [pos, actions]);
  const setRot = useCallback((axis: "x" | "y" | "z", deg: number) => {
    const r = rot.clone(); r[axis] = (deg * Math.PI) / 180; actions.setRotation(r);
  }, [rot, actions]);
  const setScl = useCallback((axis: "x" | "y" | "z", v: number) => {
    const s = scl.clone(); s[axis] = v; actions.setScale(s);
  }, [scl, actions]);

  const sizeUU = state.modelSize ? {
    h: Math.round(state.modelSize.y * UU * scl.y),
    w: Math.round(state.modelSize.x * UU * scl.x),
    d: Math.round(state.modelSize.z * UU * scl.z),
  } : null;

  return (
    <>
      {/* Transform */}
      <Section title="Transform">
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontWeight: 600 }}>Position</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            <NumInput label="X" value={pos.x} color="#f44336" onChange={(v) => setPos("x", v)} />
            <NumInput label="Y" value={pos.y} color="#4caf50" onChange={(v) => setPos("y", v)} />
            <NumInput label="Z" value={pos.z} color="#2196f3" onChange={(v) => setPos("z", v)} />
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontWeight: 600 }}>Rotation (deg)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            <NumInput label="X" value={(rot.x * 180) / Math.PI} color="#f44336" onChange={(v) => setRot("x", v)} />
            <NumInput label="Y" value={(rot.y * 180) / Math.PI} color="#4caf50" onChange={(v) => setRot("y", v)} />
            <NumInput label="Z" value={(rot.z * 180) / Math.PI} color="#2196f3" onChange={(v) => setRot("z", v)} />
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontWeight: 600 }}>Scale</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            <NumInput label="X" value={scl.x} color="#f44336" onChange={(v) => setScl("x", v)} />
            <NumInput label="Y" value={scl.y} color="#4caf50" onChange={(v) => setScl("y", v)} />
            <NumInput label="Z" value={scl.z} color="#2196f3" onChange={(v) => setScl("z", v)} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontWeight: 600 }}>Axis Correction</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            {(["x", "y", "z"] as const).map((axis) => (
              <button key={axis} type="button" style={propsBtnStyle(false)} onClick={() => {
                actions.pushUndo("Axis correction");
                const r = rot.clone();
                r[axis] += Math.PI / 2;
                actions.setRotation(r);
              }}>
                <RotateCw size={10} /> +90 {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Dimensions */}
      {sizeUU && (
        <Section title="Dimensions (UU)">
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 8px", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6c63ff" }}>H</span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "monospace" }}>{sizeUU.h}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#4db6ac" }}>W</span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "monospace" }}>{sizeUU.w}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#ff6e40" }}>D</span>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "monospace" }}>{sizeUU.d}</span>
          </div>
        </Section>
      )}

      {/* Pivot */}
      <Section title="Pivot">
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "monospace", marginBottom: 6 }}>
          {state.pivotOffset.x.toFixed(2)}, {state.pivotOffset.y.toFixed(2)}, {state.pivotOffset.z.toFixed(2)}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={actions.snapPivotToBottom} style={propsBtnStyle(false)} className="flex-1">Bottom (B)</button>
          <button type="button" onClick={actions.snapPivotToCenter} style={propsBtnStyle(false)} className="flex-1">Center</button>
        </div>
      </Section>

      {/* Snapping */}
      <Section title="Snapping">
        <SnapRow label="Grid (G)" active={state.gridSnap.enabled} onToggle={() => actions.setGridSnap({ enabled: !state.gridSnap.enabled })}
          value={state.gridSnap.value} onChange={(v) => actions.setGridSnap({ value: v })} options={[10, 50, 100, 200, 500]} unit="UU" />
        <SnapRow label="Rotate" active={state.rotateSnap.enabled} onToggle={() => actions.setRotateSnap({ enabled: !state.rotateSnap.enabled })}
          value={state.rotateSnap.value} onChange={(v) => actions.setRotateSnap({ value: v })} options={[5, 10, 15, 30, 45, 90]} unit="°" />
        <SnapRow label="Scale" active={state.scaleSnap.enabled} onToggle={() => actions.setScaleSnap({ enabled: !state.scaleSnap.enabled })}
          value={state.scaleSnap.value} onChange={(v) => actions.setScaleSnap({ value: v })} options={[10, 50, 100, 200, 500]} unit="UU" />
      </Section>

      {/* Reference Blocks */}
      <Section title="Reference Blocks">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          {[128, 256, 512, 500].map((size) => (
            <button key={size} type="button" onClick={() => actions.addRefBlock(size)} style={propsBtnStyle(false)}>
              {size}
            </button>
          ))}
        </div>
        {state.refBlocks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {state.refBlocks.map((block) => (
              <div
                key={block.id}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "3px 6px", borderRadius: 4, cursor: "pointer",
                  background: state.selectedBlockId === block.id ? "rgba(139,92,246,0.15)" : "transparent",
                  border: state.selectedBlockId === block.id ? "1px solid rgba(139,92,246,0.3)" : "1px solid transparent",
                }}
                onClick={() => actions.setSelectedBlock(block.id)}
              >
                <span style={{ flex: 1, fontSize: 10, color: "var(--color-text-primary)" }}>{block.sizeUU}×{block.sizeUU}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); actions.toggleBlockVisibility(block.id); }}
                  style={iconBtnStyle} title={block.visible ? "Hide" : "Show"}>
                  {block.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); actions.duplicateRefBlock(block.id); }}
                  style={iconBtnStyle} title="Duplicate">
                  <Copy size={10} />
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); actions.removeRefBlock(block.id); }}
                  style={{ ...iconBtnStyle, color: "#ef4444" }} title="Delete">
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            <button type="button" onClick={actions.clearAllBlocks} style={propsBtnStyle(false)}>Clear All</button>
          </div>
        )}
      </Section>

      {/* FFD Modifier */}
      <Section title="FFD Modifier" defaultCollapsed={!state.ffd.enabled}>
        <button
          type="button"
          onClick={() => actions.setFFDEnabled(!state.ffd.enabled)}
          style={propsBtnStyle(state.ffd.enabled)}
        >
          {state.ffd.enabled ? "Disable FFD" : "Enable FFD (F)"}
        </button>
        {state.ffd.enabled && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 4, fontWeight: 600 }}>Grid Divisions</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
              {(["x", "y", "z"] as const).map((axis) => (
                <div key={axis} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: axis === "x" ? "#f44336" : axis === "y" ? "#4caf50" : "#2196f3" }}>
                    {axis.toUpperCase()}
                  </span>
                  <input
                    type="number" min={1} max={8} value={state.ffd.divisions[axis]}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(8, Number(e.target.value)));
                      actions.setFFDDivisions({ ...state.ffd.divisions, [axis]: v });
                    }}
                    style={{
                      width: "100%", padding: "3px 6px", fontSize: 11, fontFamily: "monospace", textAlign: "center",
                      background: "var(--color-input-bg)", border: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)", borderRadius: 4,
                    }}
                  />
                </div>
              ))}
            </div>
            {state.ffd.selectedPointIndices.length > 0 && (
              <div style={{ fontSize: 10, color: "#ff6e40", marginTop: 6 }}>
                {state.ffd.selectedPointIndices.length} point{state.ffd.selectedPointIndices.length > 1 ? "s" : ""} selected
              </div>
            )}
            <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
              Shift + click to multi-select points
            </div>
          </div>
        )}
      </Section>

      {/* Actions */}
      <Section title="Actions">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" onClick={() => { actions.pushUndo("Center to origin"); actions.centerToOrigin(); }} style={propsBtnStyle(false)}>
            Center to Origin (C)
          </button>
          <button type="button" onClick={() => { actions.pushUndo("Reset transform"); actions.resetTransform(); }} style={propsBtnStyle(false)}>
            Reset Transform
          </button>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={actions.undo} disabled={!state.canUndo}
              style={{ ...propsBtnStyle(false), flex: 1, opacity: state.canUndo ? 1 : 0.4 }}>
              <Undo2 size={10} /> Undo
            </button>
            <button type="button" onClick={actions.redo} disabled={!state.canRedo}
              style={{ ...propsBtnStyle(false), flex: 1, opacity: state.canRedo ? 1 : 0.4 }}>
              <Redo2 size={10} /> Redo
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

/* ── Snap row helper ── */

function SnapRow({ label, active, onToggle, value, onChange, options, unit }: {
  label: string; active: boolean; onToggle: () => void; value: number; onChange: (v: number) => void; options: number[]; unit: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
      <button type="button" onClick={onToggle} style={{
        ...propsBtnStyle(active), flex: "0 0 auto", minWidth: 52, fontSize: 10,
      }}>{label}</button>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          flex: 1, padding: "3px 4px", fontSize: 10, borderRadius: 4, cursor: "pointer",
          background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)",
        }}
      >
        {options.map((v) => <option key={v} value={v}>{v} {unit}</option>)}
      </select>
    </div>
  );
}

/* ── Status Bar ── */

function StatusBar() {
  const { state } = useModelWorkshop();
  const pos = state.position;
  const rot = state.rotation;
  const scl = state.scale;
  const UU = 100;

  const sizeUU = state.modelSize ? {
    h: Math.round(state.modelSize.y * UU * scl.y),
    w: Math.round(state.modelSize.x * UU * scl.x),
    d: Math.round(state.modelSize.z * UU * scl.z),
  } : null;

  const items: { label: string; value: string; color?: string }[] = [
    { label: "Pos", value: `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}` },
    { label: "Rot", value: `${((rot.x * 180) / Math.PI).toFixed(1)}°, ${((rot.y * 180) / Math.PI).toFixed(1)}°, ${((rot.z * 180) / Math.PI).toFixed(1)}°` },
    { label: "Scl", value: `${scl.x.toFixed(2)}, ${scl.y.toFixed(2)}, ${scl.z.toFixed(2)}` },
  ];
  if (sizeUU) items.push({ label: "Size", value: `${sizeUU.h}×${sizeUU.w}×${sizeUU.d} UU`, color: "#a78bfa" });
  if (state.ffd.enabled) items.push({ label: "FFD", value: `${state.ffd.divisions.x}×${state.ffd.divisions.y}×${state.ffd.divisions.z}`, color: "#ff6e40" });
  if (state.gridSnap.enabled) items.push({ label: "Snap", value: `${state.gridSnap.value} UU`, color: "#4db6ac" });

  return (
    <div
      className="shrink-0 flex items-center gap-3 px-3"
      style={{ height: 24, borderTop: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 10, fontFamily: "monospace" }}
    >
      {items.map((item, i) => (
        <span key={i}>
          <span style={{ color: "var(--color-text-muted)", marginRight: 4 }}>{item.label}</span>
          <span style={{ color: item.color || "var(--color-text-secondary)" }}>{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/* ── Shared styles ── */

function propsBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
    border: active ? "1px solid rgba(139,92,246,0.4)" : "1px solid var(--color-border)",
    background: active ? "rgba(139,92,246,0.15)" : "var(--color-input-bg)",
    color: active ? "#a78bfa" : "var(--color-text-secondary)",
  };
}

const iconBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none", padding: 2, cursor: "pointer",
  color: "var(--color-text-muted)", display: "inline-flex", alignItems: "center",
};

/* ── Inner Shell (inside context provider) ── */

function ModelWorkshopInner({ succeededJobs, initialModelUrl, initialJobId, onLoadModel }: ModelWorkshopTabProps) {
  const { state, actions } = useModelWorkshop();
  const { addToast } = useToastContext();
  const [modelUrl, setModelUrl] = useState<string | null>(initialModelUrl ?? null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialJobId ?? null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const activeChannelRef = useRef<keyof TextureMap | null>(null);
  const [selectedTexSlot, setSelectedTexSlot] = useState(-1);
  const [slotTextures, setSlotTextures] = useState<Record<number, TextureMap>>({});
  const [slotTexPreviews, setSlotTexPreviews] = useState<Record<number, Record<string, string>>>({});

  const textures = slotTextures[selectedTexSlot] ?? {};
  const texturePreviews = slotTexPreviews[selectedTexSlot] ?? {};

  useEffect(() => {
    if (initialModelUrl && initialModelUrl !== modelUrl) {
      setModelUrl(initialModelUrl);
      setSelectedJobId(initialJobId ?? null);
    }
  }, [initialModelUrl, initialJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJobSelect = useCallback(async (jobId: string) => {
    const job = succeededJobs.find((j) => j.task_id === jobId);
    if (!job) return;
    setLoading(true);
    setSelectedJobId(jobId);
    try {
      const url = await onLoadModel(job);
      setModelUrl(url);
    } catch {
      setModelUrl(null);
    }
    setLoading(false);
  }, [succeededJobs, onLoadModel]);

  const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["fbx", "glb", "gltf", "obj"].includes(ext)) {
      addToast("Unsupported format — use FBX, GLB, GLTF, or OBJ", "error");
      return;
    }
    const needsConversion = ["fbx", "obj", "stl"].includes(ext);
    if (needsConversion) {
      setLoading(true);
      addToast(`Converting ${file.name} via Blender — this may take a moment…`, "info");
      try {
        const project = await uploadModel(file);
        const ver = project.versions?.[0];
        if (ver?.glbFile) {
          setModelUrl(getModelUrl(project.id, ver.glbFile));
          setSelectedJobId(null);
          addToast(`Imported ${file.name} (${project.name})`, "success");
        } else {
          throw new Error("Conversion produced no GLB");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addToast(`Import failed: ${msg}`, "error");
      }
      setLoading(false);
    } else {
      const blobUrl = URL.createObjectURL(file);
      setModelUrl(`${blobUrl}#${file.name}`);
      setSelectedJobId(null);
      addToast(`Loaded ${file.name}`, "success");
    }
  }, [addToast]);

  const handleTextureSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const channel = activeChannelRef.current;
    if (!file || !channel) return;
    e.target.value = "";
    const url = URL.createObjectURL(file);
    const slot = selectedTexSlot;
    setSlotTextures((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? {}), [channel]: url } }));
    setSlotTexPreviews((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? {}), [channel]: url } }));
    addToast(`${channel} texture loaded`, "success");
  }, [addToast, selectedTexSlot]);

  const removeTexture = useCallback((channel: keyof TextureMap) => {
    const slot = selectedTexSlot;
    setSlotTextures((prev) => {
      const cur = { ...(prev[slot] ?? {}) };
      if (cur[channel]) URL.revokeObjectURL(cur[channel]!);
      delete cur[channel];
      return { ...prev, [slot]: cur };
    });
    setSlotTexPreviews((prev) => {
      const cur = { ...(prev[slot] ?? {}) };
      delete cur[channel];
      return { ...prev, [slot]: cur };
    });
  }, [selectedTexSlot]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    for (const file of Array.from(e.dataTransfer.files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (["fbx", "glb", "gltf", "obj"].includes(ext)) {
        const needsConversion = ["fbx", "obj", "stl"].includes(ext);
        if (needsConversion) {
          setLoading(true);
          addToast(`Converting ${file.name} via Blender…`, "info");
          try {
            const project = await uploadModel(file);
            const ver = project.versions?.[0];
            if (ver?.glbFile) {
              setModelUrl(getModelUrl(project.id, ver.glbFile));
              setSelectedJobId(null);
              addToast(`Imported ${file.name}`, "success");
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            addToast(`Import failed: ${msg}`, "error");
          }
          setLoading(false);
        } else {
          const blobUrl = URL.createObjectURL(file);
          setModelUrl(`${blobUrl}#${file.name}`);
          setSelectedJobId(null);
          addToast(`Loaded ${file.name}`, "success");
        }
      } else if (["png", "jpg", "jpeg", "tga", "bmp", "webp"].includes(ext)) {
        const url = URL.createObjectURL(file);
        const name = file.name.toLowerCase();
        let channel: keyof TextureMap = "diffuse";
        if (name.includes("normal") || name.includes("nrm")) channel = "normal";
        else if (name.includes("rough")) channel = "roughness";
        else if (name.includes("metal")) channel = "metalness";
        else if (name.includes("ao") || name.includes("occlusion") || name.includes("ambient")) channel = "ao";
        else if (name.includes("emissive") || name.includes("emission")) channel = "emissive";
        else if (name.includes("diffuse") || name.includes("color") || name.includes("albedo") || name.includes("base")) channel = "diffuse";
        const slot = selectedTexSlot;
        setSlotTextures((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? {}), [channel]: url } }));
        setSlotTexPreviews((prev) => ({ ...prev, [slot]: { ...(prev[slot] ?? {}), [channel]: url } }));
        addToast(`Auto-assigned ${file.name} → ${channel}`, "success");
      }
    }
  }, [addToast, selectedTexSlot]);

  const hasTextures = Object.values(slotTextures).some((t) => Object.keys(t).length > 0);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* ── Top toolbar ── */}
      <div
        className="shrink-0 flex items-center gap-1 px-2"
        style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        {/* Model selector */}
        <select
          value={selectedJobId ?? ""}
          onChange={(e) => e.target.value && handleJobSelect(e.target.value)}
          style={{
            padding: "3px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer", maxWidth: 180,
            background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)",
          }}
        >
          <option value="">Select a model...</option>
          {succeededJobs.map((job) => (
            <option key={job.task_id} value={job.task_id}>
              {job.service === "meshy" ? "Meshy" : "Hitem3D"} — {job.task_id.slice(0, 10)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: "3px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
            background: "var(--color-input-bg)", border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)", display: "inline-flex", alignItems: "center", gap: 4,
          }}
        >
          <Upload size={11} /> Import Model
        </button>
        <input ref={fileInputRef} type="file" accept=".glb,.gltf,.fbx,.obj" className="hidden" onChange={handleFileImport} />

        <div className="w-px h-5 mx-1" style={{ background: "var(--color-border)" }} />

        {/* Tool buttons */}
        {TOOL_ITEMS.map((item) => {
          const active = item.tool === "ffd" ? state.ffd.enabled : state.activeTool === item.tool;
          const Icon = item.icon;
          return (
            <button
              key={item.tool}
              type="button"
              title={`${item.label} (${item.shortcut})`}
              onClick={() => {
                if (item.tool === "ffd") actions.setFFDEnabled(!state.ffd.enabled);
                else actions.setActiveTool(item.tool);
              }}
              style={{
                padding: "4px 6px", borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3,
                background: active ? "rgba(139,92,246,0.15)" : "transparent",
                border: active ? "1px solid rgba(139,92,246,0.3)" : "1px solid transparent",
                color: active ? "#a78bfa" : "var(--color-text-muted)",
                fontSize: 10, fontWeight: 600,
              }}
            >
              <Icon size={13} />
            </button>
          );
        })}

        <div className="w-px h-5 mx-1" style={{ background: "var(--color-border)" }} />

        {/* View toggles */}
        <button type="button" title="Wireframe" onClick={() => actions.setWireframe(!state.wireframe)}
          style={viewToggleStyle(state.wireframe)}>
          <Triangle size={12} />
        </button>
        <button type="button" title="Normals (N)" onClick={() => actions.setShowNormals(!state.showNormals)}
          style={viewToggleStyle(state.showNormals)}>
          <Box size={12} />
        </button>

        <div className="flex-1" />

        {/* Undo/Redo */}
        <button type="button" title="Undo (Ctrl+Z)" onClick={actions.undo} disabled={!state.canUndo}
          style={{ ...viewToggleStyle(false), opacity: state.canUndo ? 1 : 0.35 }}>
          <Undo2 size={12} />
        </button>
        <button type="button" title="Redo (Ctrl+Shift+Z)" onClick={actions.redo} disabled={!state.canRedo}
          style={{ ...viewToggleStyle(false), opacity: state.canRedo ? 1 : 0.35 }}>
          <Redo2 size={12} />
        </button>
      </div>

      <input ref={textureInputRef} type="file" accept="image/*,.tga" className="hidden" onChange={handleTextureSelect} />

      {/* ── Main area ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Viewport */}
        <div
          className="flex-1 min-w-0 min-h-0 relative"
          ref={(el) => { (state.canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = el; }}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--color-background)" }}>
              <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-text-muted)" }} />
            </div>
          ) : modelUrl ? (
            <Canvas
              camera={{ position: [0, 2, 5], fov: 45, near: 0.1, far: 200 }}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
              gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
              dpr={[1, 2]}
              resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <CameraCapture />
              <color attach="background" args={["#1a1a1c"]} />
              <ambientLight intensity={0.45} />
              <directionalLight position={[5, 10, 6]} intensity={1.15} />
              <directionalLight position={[-4, 4, -3]} intensity={0.35} />
              <Suspense fallback={null}>
                <Environment preset="studio" />
                <WorkshopModelScene url={modelUrl} slotTextures={hasTextures ? slotTextures : undefined} materialSlots={state.materialSlots} />
              </Suspense>
              <WorkshopTransformGizmo />
              <ModelWorkshopFFD />
              <FFDOrbitGuard />
              <ModelWorkshopRefBlocks />
              <OrbitControls
                makeDefault
                enablePan
                enableZoom
                enableRotate
                mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
              />
              <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
                <GizmoViewport labelColor="white" axisHeadScale={0.8} />
              </GizmoHelper>
              <DynamicGrid />
            </Canvas>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8">
              <Upload size={40} style={{ color: "var(--color-text-muted)", opacity: 0.3 }} />
              <p className="text-xs font-medium text-center" style={{ color: "var(--color-text-muted)" }}>
                Drag & drop a model file here, or use Import Model above
              </p>
              <p className="text-[10px] text-center" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>
                Supports FBX, GLB, GLTF, OBJ — you can also drop texture images
              </p>
            </div>
          )}

          {state.ffd.enabled && modelUrl && (
            <div
              style={{
                position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
                padding: "4px 12px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                background: "rgba(0,0,0,0.7)", color: "#ff6e40", border: "1px solid rgba(255,110,64,0.3)",
                pointerEvents: "none",
              }}
            >
              FFD Active — Click points to select, Shift + click to multi-select
            </div>
          )}
        </div>

        {/* Properties panel */}
        <div
          className="shrink-0 overflow-y-auto flex flex-col"
          style={{ width: 220, borderLeft: "1px solid var(--color-border)", background: "var(--color-card)" }}
        >
          <PropertiesPanelInline />

          {/* Textures section */}
          <Section title={`Textures${state.materialSlots.length > 1 ? ` (${state.materialSlots.length} slots)` : ""}`}>
            {state.materialSlots.length > 1 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 3, fontWeight: 600 }}>Material Slot</div>
                <select
                  value={selectedTexSlot}
                  onChange={(e) => setSelectedTexSlot(Number(e.target.value))}
                  style={{
                    width: "100%", padding: "4px 6px", fontSize: 10, borderRadius: 4,
                    background: "var(--color-input-bg)", border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)", cursor: "pointer",
                  }}
                >
                  <option value={-1}>All Materials</option>
                  {state.materialSlots.map((slot) => (
                    <option key={slot.index} value={slot.index}>
                      {slot.name} ({slot.meshNames.length} mesh{slot.meshNames.length !== 1 ? "es" : ""})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[9px] mb-2" style={{ color: "var(--color-text-muted)" }}>
              Upload per channel or drag & drop onto the viewport.
            </p>
            <div className="flex flex-col gap-1.5">
              {TEXTURE_CHANNELS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2 px-1 py-1 rounded"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--color-border)" }}>
                  {texturePreviews[key] ? (
                    <img src={texturePreviews[key]} alt={key} className="w-6 h-6 rounded object-cover shrink-0" style={{ border: "1px solid var(--color-border)" }} />
                  ) : (
                    <div className="w-6 h-6 rounded shrink-0 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--color-border)" }}>
                      <ImageIcon size={10} style={{ color: "var(--color-text-muted)" }} />
                    </div>
                  )}
                  <span className="flex-1 text-[9px] truncate" style={{ color: "var(--color-text-primary)" }}>{label}</span>
                  {texturePreviews[key] ? (
                    <button type="button" onClick={() => removeTexture(key)}
                      className="p-0.5 rounded hover:bg-white/10 cursor-pointer"
                      style={{ color: "var(--color-text-muted)", background: "transparent", border: "none" }}>
                      <X size={10} />
                    </button>
                  ) : (
                    <button type="button"
                      onClick={() => { activeChannelRef.current = key; textureInputRef.current?.click(); }}
                      className="text-[8px] px-1.5 py-0.5 rounded cursor-pointer"
                      style={{ background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>
                      +
                    </button>
                  )}
                </div>
              ))}
            </div>
            {hasTextures && (
              <button type="button" onClick={() => {
                Object.values(slotTextures).forEach((tex) => Object.values(tex).forEach((u) => { if (u) URL.revokeObjectURL(u); }));
                setSlotTextures({}); setSlotTexPreviews({});
              }} style={propsBtnStyle(false)} className="mt-2 w-full">Clear All Textures</button>
            )}
          </Section>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />
      <KeyboardHandler />
    </div>
  );
}

function viewToggleStyle(active: boolean): React.CSSProperties {
  return {
    padding: 4, borderRadius: 4, cursor: "pointer", display: "inline-flex", alignItems: "center",
    background: active ? "rgba(255,255,255,0.1)" : "transparent",
    border: active ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
  };
}

/* ── Main Export ───────────────────────────────────────────── */

export default function ModelWorkshopTab(props: ModelWorkshopTabProps) {
  return (
    <ModelWorkshopProvider>
      <ModelWorkshopInner {...props} />
    </ModelWorkshopProvider>
  );
}
