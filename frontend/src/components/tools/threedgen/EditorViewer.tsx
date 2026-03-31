// @ts-nocheck — optional 3D deps (@react-three/fiber, drei, three) may not be installed
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Grid, OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  Box,
  ChevronDown,
  Layers,
  Loader2,
  RotateCcw,
  Triangle,
  Paintbrush,
  Image as ImageIcon,
  ArrowLeftRight,
} from "lucide-react";
import type { MaterialSlotInfo, DecalState } from "@/lib/workshopTypes";

export type ViewMode = "solid" | "wireframe" | "baseColor" | "normal" | "roughness" | "metallic";

export interface EditorViewerProps {
  modelUrl: string | null;
  compareUrl?: string | null;
  compareMode?: boolean;
  selectedSlotIndex?: number | null;
  height?: number | string;
  onMaterialsParsed?: (slots: MaterialSlotInfo[]) => void;
  onSelectSlot?: (index: number) => void;
  decalState?: DecalState | null;
  onDecalStateChange?: (state: DecalState | null) => void;
  onCenterOffset?: (offset: [number, number, number]) => void;
}

/* ── Material helpers ─────────────────────────────────────── */

function getTextureSize(tex: THREE.Texture | null): { width: number; height: number } | undefined {
  if (!tex?.image) return undefined;
  const img = tex.image as HTMLImageElement | ImageBitmap | { width: number; height: number };
  if (img.width && img.height) return { width: img.width, height: img.height };
  return undefined;
}

function parseMaterials(scene: THREE.Object3D): MaterialSlotInfo[] {
  const materialMap = new Map<THREE.Material, { meshNames: string[]; hasUVs: boolean }>();
  const materialOrder: THREE.Material[] = [];

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const hasUV = !!(child.geometry?.attributes?.uv);
    for (const mat of mats) {
      if (!mat) continue;
      const existing = materialMap.get(mat);
      if (existing) {
        if (!existing.meshNames.includes(child.name)) existing.meshNames.push(child.name);
        if (hasUV) existing.hasUVs = true;
      } else {
        materialMap.set(mat, { meshNames: [child.name], hasUVs: hasUV });
        materialOrder.push(mat);
      }
    }
  });

  return materialOrder.map((mat, index) => {
    const info = materialMap.get(mat)!;
    const std = mat as THREE.MeshStandardMaterial;
    return {
      index,
      name: mat.name || `Material ${index}`,
      meshNames: info.meshNames,
      hasUVs: info.hasUVs,
      textures: {
        baseColor: getTextureSize(std.map ?? null),
        normal: getTextureSize(std.normalMap ?? null),
        roughness: getTextureSize(std.roughnessMap ?? null),
        metallic: getTextureSize(std.metalnessMap ?? null),
      },
    };
  });
}

/* ── View mode application ────────────────────────────────── */

function getChannelTexture(mat: THREE.MeshStandardMaterial, channel: ViewMode): THREE.Texture | null {
  switch (channel) {
    case "baseColor": return mat.map;
    case "normal": return mat.normalMap;
    case "roughness": return mat.roughnessMap;
    case "metallic": return mat.metalnessMap;
    default: return null;
  }
}

function applyViewMode(
  mesh: THREE.Mesh,
  viewMode: ViewMode,
  selectedMats: Set<THREE.Material> | null,
) {
  if (!mesh.userData._edOrigMat) {
    mesh.userData._edOrigMat = mesh.material;
  }

  const orig = mesh.userData._edOrigMat as THREE.Material | THREE.Material[];
  const origArr = Array.isArray(orig) ? orig : [orig];

  if (viewMode === "solid") {
    mesh.material = orig;
    return;
  }

  if (viewMode === "wireframe") {
    if (!mesh.userData._edWire) {
      mesh.userData._edWire = new THREE.MeshBasicMaterial({ wireframe: true, color: 0x8899aa });
    }
    const w = mesh.userData._edWire as THREE.MeshBasicMaterial;
    mesh.material = Array.isArray(orig) ? orig.map(() => w) : w;
    return;
  }

  const channelMats = origArr.map((m) => {
    const std = m as THREE.MeshStandardMaterial;
    const tex = getChannelTexture(std, viewMode);
    if (tex) {
      const preview = new THREE.MeshBasicMaterial({ map: tex });
      return preview;
    }
    return new THREE.MeshBasicMaterial({ color: 0x333333 });
  });

  mesh.material = Array.isArray(orig) ? channelMats : channelMats[0];
}

/* ── Scene components ─────────────────────────────────────── */

function LoadedModel({
  url,
  viewMode,
  selectedSlotIndex,
  onParsed,
  onSelectSlot,
  materialOrderRef,
  onBoundsReady,
  onDecalPlace,
  decalPlacementActive,
  onCenterOffset,
}: {
  url: string;
  viewMode: ViewMode;
  selectedSlotIndex: number | null;
  onParsed?: (slots: MaterialSlotInfo[]) => void;
  onSelectSlot?: (index: number) => void;
  materialOrderRef: MutableRefObject<THREE.Material[]>;
  onBoundsReady?: (box: THREE.Box3) => void;
  onDecalPlace?: (point: THREE.Vector3, normal: THREE.Vector3) => void;
  decalPlacementActive?: boolean;
  onCenterOffset?: (offset: [number, number, number]) => void;
}) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => scene.clone(true), [scene, url]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevUrlRef = useRef(url);

  useEffect(() => {
    const prevUrl = prevUrlRef.current;
    prevUrlRef.current = url;
    if (prevUrl && prevUrl !== url) {
      try { useGLTF.clear(prevUrl); } catch { /* ok */ }
    }
  }, [url]);

  useEffect(() => {
    return () => {
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry?.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m?.dispose();
        const wire = child.userData._edWire as THREE.Material | undefined;
        wire?.dispose();
      });
    };
  }, [root]);

  useLayoutEffect(() => {
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      root.position.sub(center);
      root.updateMatrixWorld(true);
      box.setFromObject(root);
      if (onCenterOffset) onCenterOffset([center.x, center.y, center.z]);
    } else {
      if (onCenterOffset) onCenterOffset([0, 0, 0]);
    }

    const matOrder: THREE.Material[] = [];
    const seen = new Set<THREE.Material>();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m && !seen.has(m)) { seen.add(m); matOrder.push(m); }
      }
    });
    materialOrderRef.current = matOrder;
    if (onParsed) onParsed(parseMaterials(root));

    if (!box.isEmpty() && onBoundsReady) onBoundsReady(box);
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedMats = useMemo(() => {
    if (selectedSlotIndex == null) return null;
    const mat = materialOrderRef.current[selectedSlotIndex];
    return mat ? new Set([mat]) : null;
  }, [selectedSlotIndex, materialOrderRef]);

  useLayoutEffect(() => {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      applyViewMode(child, viewMode, selectedMats);

      if (selectedMats && viewMode === "solid") {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const isSelected = mats.some((m) => selectedMats.has(child.userData._edOrigMat ?? m));
        if (!isSelected) {
          const dim = new THREE.MeshStandardMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.3,
          });
          child.material = Array.isArray(child.material)
            ? (child.material as THREE.Material[]).map(() => dim)
            : dim;
        }
      }
    });
  }, [root, viewMode, selectedMats]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (decalPlacementActive && onDecalPlace && e.face) {
        const worldNormal = e.face.normal.clone();
        const mesh = e.object as THREE.Mesh;
        worldNormal.transformDirection(mesh.matrixWorld);
        onDecalPlace(e.point.clone(), worldNormal);
        return;
      }
      if (!onSelectSlot) return;
      const mesh = e.object as THREE.Mesh;
      const origMat = mesh.userData._edOrigMat ?? mesh.material;
      const mats = Array.isArray(origMat) ? origMat : [origMat];
      const idx = materialOrderRef.current.indexOf(mats[0]);
      if (idx >= 0) onSelectSlot(idx);
    },
    [onSelectSlot, materialOrderRef, decalPlacementActive, onDecalPlace],
  );

  return <primitive object={root} onClick={handleClick} />;
}

function CameraControls({
  resetRef,
  boundsBox,
  gizmoDragging = false,
}: {
  resetRef: MutableRefObject<(() => void) | null>;
  boundsBox: THREE.Box3 | null;
  gizmoDragging?: boolean;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  const fitCamera = useCallback(
    (box: THREE.Box3 | null) => {
      const c = controlsRef.current;
      if (!box || box.isEmpty()) {
        camera.position.set(0, 1.5, 3);
        camera.updateProjectionMatrix();
        if (c) { c.target.set(0, 0, 0); c.update(); }
        return;
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
      const dist = maxDim / (2 * Math.tan((fov * Math.PI) / 360)) * 1.4;

      camera.position.set(center.x + dist * 0.5, center.y + dist * 0.35, center.z + dist);
      (camera as THREE.PerspectiveCamera).near = Math.max(0.01, maxDim * 0.0001);
      (camera as THREE.PerspectiveCamera).far = Math.max(200, maxDim * 20);
      camera.updateProjectionMatrix();
      if (c) { c.target.copy(center); c.update(); }
    },
    [camera],
  );

  useLayoutEffect(() => {
    resetRef.current = () => fitCamera(boundsBox);
    return () => { resetRef.current = null; };
  }, [camera, resetRef, boundsBox, fitCamera]);

  useEffect(() => {
    if (boundsBox) fitCamera(boundsBox);
  }, [boundsBox, fitCamera]);

  const maxDist = useMemo(() => {
    if (!boundsBox || boundsBox.isEmpty()) return 80;
    const size = boundsBox.getSize(new THREE.Vector3());
    return Math.max(80, Math.max(size.x, size.y, size.z) * 10);
  }, [boundsBox]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!gizmoDragging}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.05}
      maxDistance={maxDist}
    />
  );
}

function AdaptiveGrid({ boundsBox }: { boundsBox: THREE.Box3 | null }) {
  const scale = useMemo(() => {
    if (!boundsBox || boundsBox.isEmpty()) return 1;
    const size = boundsBox.getSize(new THREE.Vector3());
    return Math.max(1, Math.max(size.x, size.y, size.z) / 5);
  }, [boundsBox]);

  return (
    <Grid
      infiniteGrid
      fadeDistance={45 * scale}
      fadeStrength={1}
      position={[0, -0.002, 0]}
      cellSize={0.5 * scale}
      cellThickness={0.6}
      sectionSize={3 * scale}
      sectionThickness={1}
      sectionColor="#5a5a62"
      cellColor="#3d3d44"
    />
  );
}

/* ── Decal Preview with TransformControls ─────────────────── */

function DecalPreview({
  decalState,
  onDecalStateChange,
  onDraggingChanged,
}: {
  decalState: DecalState;
  onDecalStateChange: (state: DecalState) => void;
  onDraggingChanged: (dragging: boolean) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const transformRef = useRef<any>(null);
  const [mode, setMode] = useState<"translate" | "rotate" | "scale">("translate");
  const draggingRef = useRef(false);
  const stateRef = useRef(decalState);
  stateRef.current = decalState;

  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(decalState.imageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [decalState.imageUrl]);

  useEffect(() => {
    return () => { texture.dispose(); };
  }, [texture]);

  // Apply state -> mesh (only when NOT being dragged by gizmo)
  useEffect(() => {
    const group = groupRef.current;
    if (!group || draggingRef.current) return;
    group.position.set(...decalState.position);
    group.rotation.set(...decalState.rotation);
    const s = decalState.scale;
    group.scale.set(s, s, s);
  }, [decalState.position, decalState.rotation, decalState.scale]);

  // W/E/R hotkeys (matches Model Workshop convention)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "w" || e.key === "W") setMode("translate");
      else if (e.key === "e" || e.key === "E") setMode("rotate");
      else if (e.key === "r" || e.key === "R") setMode("scale");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sync gizmo changes back to state
  useEffect(() => {
    const tc = transformRef.current;
    if (!tc) return;

    const onDragChange = (event: any) => {
      draggingRef.current = event.value;
      onDraggingChanged(event.value);

      if (!event.value) {
        // Drag ended — read final transform from the group
        const group = groupRef.current;
        if (!group) return;
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        const pos: [number, number, number] = [
          r3(group.position.x), r3(group.position.y), r3(group.position.z),
        ];
        const rot: [number, number, number] = [
          r3(group.rotation.x), r3(group.rotation.y), r3(group.rotation.z),
        ];
        // Use uniform scale from X (TransformControls may differ per axis)
        const sc = r3(Math.max(0.01, group.scale.x));
        onDecalStateChange({ ...stateRef.current, position: pos, rotation: rot, scale: sc });
      }
    };

    const onObjChange = () => {
      // Live update during drag so the panel readouts stay in sync
      if (!draggingRef.current) return;
      const group = groupRef.current;
      if (!group) return;
      // Enforce uniform scale
      if (mode === "scale") {
        const avg = (group.scale.x + group.scale.y + group.scale.z) / 3;
        group.scale.set(avg, avg, avg);
      }
    };

    tc.addEventListener("dragging-changed", onDragChange);
    tc.addEventListener("objectChange", onObjChange);
    return () => {
      tc.removeEventListener("dragging-changed", onDragChange);
      tc.removeEventListener("objectChange", onObjChange);
    };
  }, [onDraggingChanged, onDecalStateChange, mode]);

  return (
    <TransformControls ref={transformRef} mode={mode} size={0.6}>
      <group ref={groupRef}>
        <mesh>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={decalState.opacity}
            depthWrite={false}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      </group>
    </TransformControls>
  );
}

function ViewerScene({
  modelUrl,
  viewMode,
  selectedSlotIndex,
  onParsed,
  onSelectSlot,
  resetRef,
  materialOrderRef,
  decalState,
  onDecalStateChange,
  onCenterOffset,
}: {
  modelUrl: string;
  viewMode: ViewMode;
  selectedSlotIndex: number | null;
  onParsed?: (slots: MaterialSlotInfo[]) => void;
  onSelectSlot?: (index: number) => void;
  resetRef: MutableRefObject<(() => void) | null>;
  materialOrderRef: MutableRefObject<THREE.Material[]>;
  decalState?: DecalState | null;
  onDecalStateChange?: (state: DecalState | null) => void;
  onCenterOffset?: (offset: [number, number, number]) => void;
}) {
  const [boundsBox, setBoundsBox] = useState<THREE.Box3 | null>(null);
  const [gizmoDragging, setGizmoDragging] = useState(false);

  const lightScale = useMemo(() => {
    if (!boundsBox || boundsBox.isEmpty()) return 1;
    const size = boundsBox.getSize(new THREE.Vector3());
    return Math.max(1, Math.max(size.x, size.y, size.z) / 5);
  }, [boundsBox]);

  const decalPlacementActive = !!(decalState?.imageUrl && onDecalStateChange);

  const handleDecalPlace = useCallback(
    (point: THREE.Vector3, normal: THREE.Vector3) => {
      if (!decalState || !onDecalStateChange) return;
      const lookAt = new THREE.Matrix4().lookAt(
        point,
        point.clone().add(normal),
        new THREE.Vector3(0, 1, 0),
      );
      const euler = new THREE.Euler().setFromRotationMatrix(lookAt);
      onDecalStateChange({
        ...decalState,
        position: [point.x, point.y, point.z],
        rotation: [euler.x, euler.y, euler.z],
      });
    },
    [decalState, onDecalStateChange],
  );

  return (
    <>
      <color attach="background" args={["#1a1a1c"]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[5 * lightScale, 10 * lightScale, 6 * lightScale]} intensity={1.15} />
      <directionalLight position={[-4 * lightScale, 4 * lightScale, -3 * lightScale]} intensity={0.35} />
      <Environment preset="studio" />
      <AdaptiveGrid boundsBox={boundsBox} />
      <LoadedModel
        url={modelUrl}
        viewMode={viewMode}
        selectedSlotIndex={selectedSlotIndex}
        onParsed={onParsed}
        onSelectSlot={onSelectSlot}
        materialOrderRef={materialOrderRef}
        onBoundsReady={setBoundsBox}
        onDecalPlace={handleDecalPlace}
        decalPlacementActive={decalPlacementActive}
        onCenterOffset={onCenterOffset}
      />
      {decalState && onDecalStateChange && decalState.position.some((v) => v !== 0) && (
        <DecalPreview
          decalState={decalState}
          onDecalStateChange={onDecalStateChange}
          onDraggingChanged={setGizmoDragging}
        />
      )}
      <CameraControls resetRef={resetRef} boundsBox={boundsBox} gizmoDragging={gizmoDragging} />
    </>
  );
}

/* ── Toolbar button ───────────────────────────────────────── */

function TBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 600,
        border: `1px solid ${active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
        color: "var(--color-text-primary)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {children}
    </button>
  );
}

/* ── Error boundary for R3F Canvas ────────────────────────── */

class CanvasErrorBoundary extends Component<
  { children: ReactNode; retryKey: number; onError?: (e: Error) => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError?.(error); }
  componentDidUpdate(prev: { retryKey: number }) {
    if (prev.retryKey !== this.props.retryKey) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4"
          style={{ background: "#1a1a1c", color: "var(--color-text-muted)" }}>
          <Box className="h-8 w-8 opacity-50" />
          <span className="text-[11px] font-medium" style={{ color: "#ef4444" }}>
            3D Viewer Error
          </span>
          <span className="text-[10px] text-center max-w-[260px]" style={{ color: "var(--color-text-muted)" }}>
            {this.state.error.message}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Main component ───────────────────────────────────────── */

export function EditorViewer({
  modelUrl,
  compareUrl,
  compareMode = false,
  selectedSlotIndex = null,
  height = "100%",
  onMaterialsParsed,
  onSelectSlot,
  decalState,
  onDecalStateChange,
  onCenterOffset,
}: EditorViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [showingCompare, setShowingCompare] = useState(false);
  const [canvasError, setCanvasError] = useState<Error | null>(null);
  const [errorRetryKey, setErrorRetryKey] = useState(0);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const materialOrderRef = useRef<THREE.Material[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const heightStyle = typeof height === "number" ? `${height}px` : height;
  const activeUrl = compareMode && showingCompare && compareUrl ? compareUrl : modelUrl;

  useEffect(() => { setShowingCompare(false); }, [compareMode]);

  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const recoveryAttemptRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => window.dispatchEvent(new Event("resize")));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!contextLost) return;
    recoveryAttemptRef.current += 1;
    const attempt = recoveryAttemptRef.current;
    if (attempt > 3) return;
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
    const timer = setTimeout(() => {
      if (activeUrl) {
        try { useGLTF.clear(activeUrl); } catch { /* ok */ }
      }
      setContextLost(false);
      setCanvasKey((k) => k + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [contextLost, activeUrl]);

  useEffect(() => {
    recoveryAttemptRef.current = 0;
  }, [activeUrl]);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setContextLost(true);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      setContextLost(false);
      recoveryAttemptRef.current = 0;
    });
  }, []);

  return (
    <div
      className="flex flex-col w-full min-h-0 overflow-hidden"
      style={{ height: heightStyle, background: "#1a1a1c" }}
    >
      {activeUrl ? (
        <>
          {/* Toolbar */}
          <div
            className="shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1.5"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
          >
            <span className="text-[9px] font-semibold uppercase tracking-wide mr-1" style={{ color: "var(--color-text-muted)" }}>View</span>
            <TBtn active={viewMode === "solid"} onClick={() => setViewMode("solid")} title="Solid PBR"><Layers className="h-3 w-3" /> Solid</TBtn>
            <TBtn active={viewMode === "wireframe"} onClick={() => setViewMode("wireframe")} title="Wireframe"><Triangle className="h-3 w-3" /> Wire</TBtn>
            <TBtn active={viewMode === "baseColor"} onClick={() => setViewMode("baseColor")} title="Base Color"><Paintbrush className="h-3 w-3" /> Color</TBtn>
            <TBtn active={viewMode === "normal"} onClick={() => setViewMode("normal")} title="Normal Map"><ImageIcon className="h-3 w-3" /> Normal</TBtn>
            <TBtn active={viewMode === "roughness"} onClick={() => setViewMode("roughness")} title="Roughness"><ImageIcon className="h-3 w-3" /> Rough</TBtn>
            <TBtn active={viewMode === "metallic"} onClick={() => setViewMode("metallic")} title="Metallic"><ImageIcon className="h-3 w-3" /> Metal</TBtn>
            <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.08)" }} />
            <TBtn onClick={() => resetCameraRef.current?.()} title="Reset camera"><RotateCcw className="h-3 w-3" /> Reset</TBtn>
            {compareMode && compareUrl && (
              <>
                <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.08)" }} />
                <TBtn active={showingCompare} onClick={() => setShowingCompare((v) => !v)} title="Toggle A/B compare">
                  <ArrowLeftRight className="h-3 w-3" /> {showingCompare ? "Version B" : "Current"}
                </TBtn>
              </>
            )}
          </div>

          {/* Canvas */}
          <div className="relative flex-1 min-h-0" style={{ minHeight: 200 }}>
            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--color-text-muted)" }} />
                </div>
              }
            >
              <CanvasErrorBoundary
                retryKey={errorRetryKey}
                onError={(e) => setCanvasError(e)}
              >
                <div
                  ref={containerRef}
                  className="absolute inset-0"
                  onWheel={(e) => e.stopPropagation()}
                >
                  {contextLost && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
                      style={{ background: "rgba(26,26,28,0.9)", color: "var(--color-text-muted)" }}>
                      <Box className="h-8 w-8 opacity-50" />
                      {recoveryAttemptRef.current > 3 ? (
                        <>
                          <span className="text-[11px]" style={{ color: "#ef4444" }}>WebGL context lost — GPU overloaded</span>
                          <button
                            type="button"
                            className="mt-1 px-3 py-1 rounded text-[10px] font-semibold"
                            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "var(--color-text-primary)", cursor: "pointer" }}
                            onClick={() => {
                              if (activeUrl) { try { useGLTF.clear(activeUrl); } catch { /* ok */ } }
                              recoveryAttemptRef.current = 0;
                              setContextLost(false);
                              setCanvasKey((k) => k + 1);
                            }}
                          >
                            Retry
                          </button>
                        </>
                      ) : (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#eab308" }} />
                          <span className="text-[11px]" style={{ color: "#eab308" }}>WebGL context lost — recovering...</span>
                        </>
                      )}
                    </div>
                  )}
                  <Canvas
                    key={canvasKey}
                    style={{ width: "100%", height: "100%", display: "block" }}
                    camera={{ position: [0, 1.5, 3], fov: 45, near: 0.01, far: 200 }}
                    gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
                    dpr={[1, 2]}
                    resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
                    onCreated={handleCreated}
                  >
                    <ViewerScene
                      modelUrl={activeUrl}
                      viewMode={viewMode}
                      selectedSlotIndex={selectedSlotIndex}
                      onParsed={onMaterialsParsed}
                      onSelectSlot={onSelectSlot}
                      resetRef={resetCameraRef}
                      materialOrderRef={materialOrderRef}
                      decalState={decalState}
                      onDecalStateChange={onDecalStateChange}
                      onCenterOffset={onCenterOffset}
                    />
                  </Canvas>
                </div>
              </CanvasErrorBoundary>
            </Suspense>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8" style={{ color: "var(--color-text-muted)" }}>
          <Box className="h-10 w-10 opacity-50" strokeWidth={1.25} />
          <span className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>No model loaded</span>
          <span className="text-[10px] text-center max-w-[220px]" style={{ color: "var(--color-text-muted)" }}>
            Import a model or open one from the Generation Queue.
          </span>
        </div>
      )}
    </div>
  );
}
