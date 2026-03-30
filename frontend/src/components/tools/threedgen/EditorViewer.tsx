// @ts-nocheck — optional 3D deps (@react-three/fiber, drei, three) may not be installed
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Center, Environment, Grid, OrbitControls, useGLTF } from "@react-three/drei";
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
import type { MaterialSlotInfo } from "@/lib/workshopTypes";

export type ViewMode = "solid" | "wireframe" | "baseColor" | "normal" | "roughness" | "metallic";

export interface EditorViewerProps {
  modelUrl: string | null;
  compareUrl?: string | null;
  compareMode?: boolean;
  selectedSlotIndex?: number | null;
  height?: number | string;
  onMaterialsParsed?: (slots: MaterialSlotInfo[]) => void;
  onSelectSlot?: (index: number) => void;
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
}: {
  url: string;
  viewMode: ViewMode;
  selectedSlotIndex: number | null;
  onParsed?: (slots: MaterialSlotInfo[]) => void;
  onSelectSlot?: (index: number) => void;
  materialOrderRef: MutableRefObject<THREE.Material[]>;
}) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => scene.clone(true), [scene, url]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
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
      if (!onSelectSlot) return;
      const mesh = e.object as THREE.Mesh;
      const origMat = mesh.userData._edOrigMat ?? mesh.material;
      const mats = Array.isArray(origMat) ? origMat : [origMat];
      const idx = materialOrderRef.current.indexOf(mats[0]);
      if (idx >= 0) onSelectSlot(idx);
    },
    [onSelectSlot, materialOrderRef],
  );

  return (
    <Center>
      <primitive object={root} onClick={handleClick} />
    </Center>
  );
}

function CameraControls({ resetRef }: { resetRef: MutableRefObject<(() => void) | null> }) {
  const { camera } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  useLayoutEffect(() => {
    resetRef.current = () => {
      camera.position.set(0, 1.5, 3);
      camera.updateProjectionMatrix();
      const c = controlsRef.current;
      if (c) { c.target.set(0, 0, 0); c.update(); }
    };
    return () => { resetRef.current = null; };
  }, [camera, resetRef]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.4}
      maxDistance={80}
    />
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
}: {
  modelUrl: string;
  viewMode: ViewMode;
  selectedSlotIndex: number | null;
  onParsed?: (slots: MaterialSlotInfo[]) => void;
  onSelectSlot?: (index: number) => void;
  resetRef: MutableRefObject<(() => void) | null>;
  materialOrderRef: MutableRefObject<THREE.Material[]>;
}) {
  return (
    <>
      <color attach="background" args={["#1a1a1c"]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[5, 10, 6]} intensity={1.15} />
      <directionalLight position={[-4, 4, -3]} intensity={0.35} />
      <Environment preset="studio" />
      <Grid
        infiniteGrid
        fadeDistance={45}
        fadeStrength={1}
        position={[0, -0.002, 0]}
        cellSize={0.5}
        cellThickness={0.6}
        sectionSize={3}
        sectionThickness={1}
        sectionColor="#5a5a62"
        cellColor="#3d3d44"
      />
      <LoadedModel
        url={modelUrl}
        viewMode={viewMode}
        selectedSlotIndex={selectedSlotIndex}
        onParsed={onParsed}
        onSelectSlot={onSelectSlot}
        materialOrderRef={materialOrderRef}
      />
      <CameraControls resetRef={resetRef} />
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

/* ── Main component ───────────────────────────────────────── */

export function EditorViewer({
  modelUrl,
  compareUrl,
  compareMode = false,
  selectedSlotIndex = null,
  height = "100%",
  onMaterialsParsed,
  onSelectSlot,
}: EditorViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [showingCompare, setShowingCompare] = useState(false);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const materialOrderRef = useRef<THREE.Material[]>([]);

  const heightStyle = typeof height === "number" ? `${height}px` : height;
  const activeUrl = compareMode && showingCompare && compareUrl ? compareUrl : modelUrl;

  useEffect(() => { setShowingCompare(false); }, [compareMode]);

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
              <div className="absolute inset-0">
                <Canvas
                  className="!block w-full h-full touch-none"
                  camera={{ position: [0, 1.5, 3], fov: 45, near: 0.1, far: 200 }}
                  gl={{ antialias: true, alpha: false }}
                  dpr={[1, 2]}
                >
                  <ViewerScene
                    modelUrl={activeUrl}
                    viewMode={viewMode}
                    selectedSlotIndex={selectedSlotIndex}
                    onParsed={onMaterialsParsed}
                    onSelectSlot={onSelectSlot}
                    resetRef={resetCameraRef}
                    materialOrderRef={materialOrderRef}
                  />
                </Canvas>
              </div>
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
