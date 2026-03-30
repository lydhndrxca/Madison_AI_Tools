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
import { Canvas, useThree } from "@react-three/fiber";
import {
  Center,
  Environment,
  Grid,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  Box,
  ChevronDown,
  Download,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Triangle,
} from "lucide-react";

export type ModelViewerExportFormat = "glb" | "obj" | "fbx" | "usdz";

/** Texture map to apply to imported models (keyed by channel name). */
export interface TextureMap {
  diffuse?: string;
  normal?: string;
  roughness?: string;
  metalness?: string;
  ao?: string;
  emissive?: string;
}

export interface ModelViewerProps {
  /** URL or blob URL to a GLB / GLTF / FBX / OBJ file */
  modelUrl: string | null;
  /** Optional thumbnail while loading */
  thumbnailUrl?: string;
  /** Height of the viewer */
  height?: number | string;
  /** Called when user picks an export format */
  onExport?: (format: ModelViewerExportFormat, modelUrl: string) => void;
  /** Optional texture URLs to apply to the model */
  textures?: TextureMap;
}

function detectFormat(url: string): "glb" | "fbx" | "obj" | "gltf" {
  const lower = url.toLowerCase();
  const hash = lower.split("#").pop() ?? "";
  if (hash.endsWith(".fbx") || lower.replace(/[?#].*$/, "").endsWith(".fbx")) return "fbx";
  if (hash.endsWith(".obj") || lower.replace(/[?#].*$/, "").endsWith(".obj")) return "obj";
  if (hash.endsWith(".gltf") || lower.replace(/[?#].*$/, "").endsWith(".gltf")) return "gltf";
  return "glb";
}

type ViewMode = "solid" | "wireframe" | "normals";

const EXPORT_FORMATS: ModelViewerExportFormat[] = ["glb", "obj", "fbx", "usdz"];

function applyViewModeToMesh(mesh: THREE.Mesh, viewMode: ViewMode) {
  if (!mesh.userData._mvOrigMat) {
    mesh.userData._mvOrigMat = mesh.material;
  }
  if (!mesh.userData._mvWire) {
    mesh.userData._mvWire = new THREE.MeshBasicMaterial({
      wireframe: true,
      color: 0x8899aa,
    });
  }
  if (!mesh.userData._mvNorm) {
    mesh.userData._mvNorm = new THREE.MeshNormalMaterial();
  }

  const orig = mesh.userData._mvOrigMat as THREE.Material | THREE.Material[];

  if (viewMode === "solid") {
    mesh.material = orig;
    return;
  }

  if (viewMode === "wireframe") {
    const w = mesh.userData._mvWire as THREE.MeshBasicMaterial;
    mesh.material = Array.isArray(orig)
      ? orig.map(() => w)
      : w;
    return;
  }

  const n = mesh.userData._mvNorm as THREE.MeshNormalMaterial;
  mesh.material = Array.isArray(orig) ? orig.map(() => n) : n;
}

function LoadedModel({ url, viewMode }: { url: string; viewMode: ViewMode }) {
  const { scene } = useGLTF(url);
  const root = useMemo(() => scene.clone(true), [scene, url]);

  useLayoutEffect(() => {
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        applyViewModeToMesh(child, viewMode);
      }
    });
  }, [root, viewMode]);

  return (
    <Center>
      <primitive object={root} />
    </Center>
  );
}

function applyTexturesToGroup(group: THREE.Group | THREE.Object3D, textures?: TextureMap) {
  if (!textures) return;
  const loader = new THREE.TextureLoader();
  const maps: Partial<Record<string, THREE.Texture>> = {};
  const load = (url?: string) => url ? loader.load(url) : undefined;
  if (textures.diffuse) maps.map = load(textures.diffuse);
  if (textures.normal) maps.normalMap = load(textures.normal);
  if (textures.roughness) maps.roughnessMap = load(textures.roughness);
  if (textures.metalness) maps.metalnessMap = load(textures.metalness);
  if (textures.ao) maps.aoMap = load(textures.ao);
  if (textures.emissive) maps.emissiveMap = load(textures.emissive);
  if (Object.keys(maps).length === 0) return;

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = new THREE.MeshStandardMaterial();
      if (maps.map) mat.map = maps.map;
      if (maps.normalMap) mat.normalMap = maps.normalMap;
      if (maps.roughnessMap) mat.roughnessMap = maps.roughnessMap;
      if (maps.metalnessMap) { mat.metalnessMap = maps.metalnessMap; mat.metalness = 1; }
      if (maps.aoMap) mat.aoMap = maps.aoMap;
      if (maps.emissiveMap) { mat.emissiveMap = maps.emissiveMap; mat.emissive = new THREE.Color(1, 1, 1); }
      mat.needsUpdate = true;
      child.material = mat;
    }
  });
}

function LoadedFBX({ url, viewMode, textures }: { url: string; viewMode: ViewMode; textures?: TextureMap }) {
  const [root, setRoot] = useState<THREE.Group | null>(null);
  const cleanUrl = url.split("#")[0];

  useEffect(() => {
    const loader = new FBXLoader();
    loader.load(
      cleanUrl,
      (fbx) => {
        fbx.scale.setScalar(0.01);
        applyTexturesToGroup(fbx, textures);
        setRoot(fbx);
      },
      undefined,
      (err) => { throw new Error(`FBX load failed: ${err}`); },
    );
    return () => { setRoot(null); };
  }, [url, textures]);

  useLayoutEffect(() => {
    if (!root) return;
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) applyViewModeToMesh(child, viewMode);
    });
  }, [root, viewMode]);

  if (!root) return null;
  return <Center><primitive object={root} /></Center>;
}

function LoadedOBJ({ url, viewMode, textures }: { url: string; viewMode: ViewMode; textures?: TextureMap }) {
  const [root, setRoot] = useState<THREE.Group | null>(null);
  const cleanUrl = url.split("#")[0];

  useEffect(() => {
    const loader = new OBJLoader();
    loader.load(
      cleanUrl,
      (obj) => {
        applyTexturesToGroup(obj, textures);
        setRoot(obj);
      },
      undefined,
      (err) => { throw new Error(`OBJ load failed: ${err}`); },
    );
    return () => { setRoot(null); };
  }, [url, textures]);

  useLayoutEffect(() => {
    if (!root) return;
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) applyViewModeToMesh(child, viewMode);
    });
  }, [root, viewMode]);

  if (!root) return null;
  return <Center><primitive object={root} /></Center>;
}

function CameraControlsWithReset({
  resetRef,
}: {
  resetRef: MutableRefObject<(() => void) | null>;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  useLayoutEffect(() => {
    resetRef.current = () => {
      camera.position.set(0, 1.5, 3);
      camera.updateProjectionMatrix();
      const c = controlsRef.current;
      if (c) {
        c.target.set(0, 0, 0);
        c.update();
      }
    };
    return () => {
      resetRef.current = null;
    };
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
  resetRef,
  textures,
}: {
  modelUrl: string;
  viewMode: ViewMode;
  resetRef: MutableRefObject<(() => void) | null>;
  textures?: TextureMap;
}) {
  const fmt = useMemo(() => detectFormat(modelUrl), [modelUrl]);

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
      {fmt === "fbx" ? (
        <LoadedFBX url={modelUrl} viewMode={viewMode} textures={textures} />
      ) : fmt === "obj" ? (
        <LoadedOBJ url={modelUrl} viewMode={viewMode} textures={textures} />
      ) : (
        <LoadedModel url={modelUrl} viewMode={viewMode} />
      )}
      <CameraControlsWithReset resetRef={resetRef} />
    </>
  );
}

class ModelCanvasErrorBoundary extends Component<
  {
    children: ReactNode;
    retryKey: number;
    onError?: (e: Error, info: ErrorInfo) => void;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: { retryKey: number }) {
    if (prevProps.retryKey !== this.props.retryKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return null;
    }
    return this.props.children;
  }
}

function toolbarBtnStyle(active: boolean): React.CSSProperties {
  return {
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
  };
}

export function ModelViewer({
  modelUrl,
  thumbnailUrl,
  height = 360,
  onExport,
  textures,
}: ModelViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("solid");
  const [exportOpen, setExportOpen] = useState(false);
  const [errorRetryKey, setErrorRetryKey] = useState(0);
  const [canvasError, setCanvasError] = useState<Error | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const exportWrapRef = useRef<HTMLDivElement>(null);

  const heightStyle = typeof height === "number" ? `${height}px` : height;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!exportWrapRef.current?.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const handleRetry = useCallback(() => {
    setCanvasError(null);
    setErrorRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setCanvasError(null);
  }, [modelUrl]);

  const handleExportPick = useCallback(
    (format: ModelViewerExportFormat) => {
      if (modelUrl) onExport?.(format, modelUrl);
      setExportOpen(false);
    },
    [modelUrl, onExport],
  );

  return (
    <div
      className="flex flex-col w-full min-h-0 rounded-lg overflow-hidden"
      style={{
        height: heightStyle,
        border: "1px solid var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      {modelUrl ? (
        <>
          <div
            className="shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1.5"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span
              className="text-[9px] font-semibold uppercase tracking-wide mr-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              View
            </span>
            <button
              type="button"
              title="Solid PBR view"
              style={toolbarBtnStyle(viewMode === "solid")}
              onClick={() => setViewMode("solid")}
            >
              <Layers className="h-3 w-3" />
              Solid
            </button>
            <button
              type="button"
              title="Wireframe view"
              style={toolbarBtnStyle(viewMode === "wireframe")}
              onClick={() => setViewMode("wireframe")}
            >
              <Triangle className="h-3 w-3" />
              Wire
            </button>
            <button
              type="button"
              title="Normals view"
              style={toolbarBtnStyle(viewMode === "normals")}
              onClick={() => setViewMode("normals")}
            >
              <Box className="h-3 w-3" />
              Normals
            </button>
            <div className="w-px h-4 mx-0.5" style={{ background: "var(--color-border)" }} />
            <button
              type="button"
              title="Reset camera position"
              style={toolbarBtnStyle(false)}
              onClick={() => resetCameraRef.current?.()}
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
            <div className="flex-1 min-w-[8px]" />
            <div className="relative" ref={exportWrapRef}>
              <button
                type="button"
                title="Export model to disk"
                disabled={!onExport}
                style={{
                  ...toolbarBtnStyle(false),
                  opacity: onExport ? 1 : 0.45,
                  cursor: onExport ? "pointer" : "not-allowed",
                }}
                onClick={() => onExport && setExportOpen((o) => !o)}
              >
                <Download className="h-3 w-3" />
                Export
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
              {exportOpen && onExport && (
                <div
                  className="absolute right-0 top-full mt-1 z-20 py-1 rounded-md shadow-lg min-w-[120px]"
                  style={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {EXPORT_FORMATS.map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      className="w-full text-left px-2.5 py-1.5 text-[11px] cursor-pointer hover:bg-white/5"
                      style={{ color: "var(--color-text-primary)" }}
                      onClick={() => handleExportPick(fmt)}
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="relative flex-1 min-h-0" style={{ minHeight: 200 }}>
            {canvasError ? (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center z-10"
                style={{ background: "var(--color-card)" }}
              >
                <p className="text-[11px] max-w-xs" style={{ color: "var(--color-text-secondary)" }}>
                  Could not load this model. Check the URL or file and try again.
                </p>
                <p
                  className="text-[9px] font-mono max-w-full truncate px-2"
                  style={{ color: "var(--color-text-muted)" }}
                  title={canvasError.message}
                >
                  {canvasError.message}
                </p>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                  onClick={handleRetry}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            ) : null}

            <Suspense
              fallback={
                <div className="absolute inset-0 flex items-center justify-center z-[1]">
                  {thumbnailUrl ? (
                    <div
                      className="absolute inset-0 bg-cover bg-center opacity-40"
                      style={{ backgroundImage: `url(${thumbnailUrl})` }}
                    />
                  ) : null}
                  <div
                    className="relative flex flex-col items-center gap-2 px-4 py-3 rounded-lg"
                    style={{
                      background: "rgba(0,0,0,0.35)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <Loader2
                      className="h-6 w-6 animate-spin"
                      style={{ color: "var(--color-text-muted)" }}
                    />
                    <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
                      Loading 3D model…
                    </span>
                  </div>
                </div>
              }
            >
              <ModelCanvasErrorBoundary
                retryKey={errorRetryKey}
                onError={(e) => setCanvasError(e)}
              >
                <div className="absolute inset-0">
                  <Canvas
                    className="!block w-full h-full touch-none"
                    camera={{ position: [0, 1.5, 3], fov: 45, near: 0.1, far: 200 }}
                    gl={{ antialias: true, alpha: false }}
                    dpr={[1, 2]}
                  >
                    <ViewerScene
                      modelUrl={modelUrl}
                      viewMode={viewMode}
                      resetRef={resetCameraRef}
                      textures={textures}
                    />
                  </Canvas>
                </div>
              </ModelCanvasErrorBoundary>
            </Suspense>
          </div>
        </>
      ) : (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8"
          style={{ color: "var(--color-text-muted)" }}
        >
          <Box className="h-10 w-10 opacity-50" strokeWidth={1.25} />
          <span className="text-[11px] font-medium" style={{ color: "var(--color-text-secondary)" }}>
            No model loaded
          </span>
          <span className="text-[10px] text-center max-w-[220px]" style={{ color: "var(--color-text-muted)" }}>
            Provide a GLB, GLTF, FBX, or OBJ file to preview it here.
          </span>
        </div>
      )}
    </div>
  );
}
