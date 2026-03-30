import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/* ── Types ─────────────────────────────────────────────────── */

export type EditorTool = "select" | "move" | "rotate" | "scale" | "ffd";
export type TransformMode = "translate" | "rotate" | "scale";

export interface FFDState {
  enabled: boolean;
  divisions: { x: number; y: number; z: number };
  latticePoints: THREE.Vector3[];
  selectedPointIndices: number[];
}

export interface RefBlock {
  id: string;
  sizeUU: number;
  position: THREE.Vector3;
  visible: boolean;
}

export interface SnapSettings {
  enabled: boolean;
  value: number;
}

export interface HistoryEntry {
  label: string;
  timestamp: number;
  snapshot: UndoSnapshot;
}

interface UndoSnapshot {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  pivotOffset: THREE.Vector3;
  ffdLatticePoints: THREE.Vector3[];
  refBlocks: RefBlock[];
}

const MAX_UNDO = 50;

export interface MaterialSlot {
  index: number;
  name: string;
  meshNames: string[];
}

export interface ModelWorkshopState {
  activeTool: EditorTool;
  transformMode: TransformMode;
  pivotOffset: THREE.Vector3;
  ffd: FFDState;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  modelBBox: THREE.Box3 | null;
  modelSize: THREE.Vector3 | null;
  wireframe: boolean;
  showNormals: boolean;
  modelRef: React.RefObject<THREE.Group | null>;
  cameraRef: React.RefObject<THREE.Camera | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  modelReady: number;
  materialSlots: MaterialSlot[];
  refBlocks: RefBlock[];
  selectedBlockId: string | null;
  gridSnap: SnapSettings;
  scaleSnap: SnapSettings;
  rotateSnap: SnapSettings;
  canUndo: boolean;
  canRedo: boolean;
  showHistory: boolean;
  historyEntries: HistoryEntry[];
}

export interface ModelWorkshopActions {
  setActiveTool: (tool: EditorTool) => void;
  setTransformMode: (mode: TransformMode) => void;
  setPivotOffset: (v: THREE.Vector3) => void;
  snapPivotToBottom: () => void;
  snapPivotToCenter: () => void;
  centerToOrigin: () => void;
  resetTransform: () => void;

  setFFDEnabled: (on: boolean) => void;
  setFFDDivisions: (d: { x: number; y: number; z: number }) => void;
  setFFDLatticePoints: (pts: THREE.Vector3[]) => void;
  setFFDSelectedPoints: (indices: number[]) => void;
  toggleFFDPointSelection: (idx: number) => void;

  setPosition: (v: THREE.Vector3) => void;
  setRotation: (e: THREE.Euler) => void;
  setScale: (v: THREE.Vector3) => void;
  setModelBBox: (box: THREE.Box3, size: THREE.Vector3) => void;
  setWireframe: (on: boolean) => void;
  setShowNormals: (on: boolean) => void;
  markDirty: () => void;

  addRefBlock: (sizeUU: number) => void;
  removeRefBlock: (id: string) => void;
  duplicateRefBlock: (id: string) => void;
  updateRefBlock: (id: string, patch: Partial<RefBlock>) => void;
  setSelectedBlock: (id: string | null) => void;
  toggleBlockVisibility: (id: string) => void;
  clearAllBlocks: () => void;

  setGridSnap: (patch: Partial<SnapSettings>) => void;
  setScaleSnap: (patch: Partial<SnapSettings>) => void;
  setRotateSnap: (patch: Partial<SnapSettings>) => void;

  notifyModelReady: () => void;
  setMaterialSlots: (slots: MaterialSlot[]) => void;

  pushUndo: (label?: string) => void;
  undo: () => void;
  redo: () => void;
  setShowHistory: (on: boolean) => void;
}

interface EditorCtx {
  state: ModelWorkshopState;
  actions: ModelWorkshopActions;
}

const Ctx = createContext<EditorCtx | null>(null);

export function useModelWorkshop(): EditorCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useModelWorkshop must be used within ModelWorkshopProvider");
  return c;
}

/* ── Provider ──────────────────────────────────────────────── */

export function ModelWorkshopProvider({ children }: { children: React.ReactNode }) {
  const modelRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const [activeTool, setActiveTool] = useState<EditorTool>("select");
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [pivotOffset, setPivotOffset] = useState(() => new THREE.Vector3());
  const [position, setPosition] = useState(() => new THREE.Vector3());
  const [rotation, setRotation] = useState(() => new THREE.Euler());
  const [scale, setScale] = useState(() => new THREE.Vector3(1, 1, 1));
  const [modelBBox, setModelBBoxState] = useState<THREE.Box3 | null>(null);
  const [modelSize, setModelSizeState] = useState<THREE.Vector3 | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [showNormals, setShowNormals] = useState(false);
  const [modelReady, setModelReady] = useState(0);
  const [materialSlots, setMaterialSlots] = useState<MaterialSlot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);

  const [ffd, setFFD] = useState<FFDState>({
    enabled: false,
    divisions: { x: 2, y: 2, z: 2 },
    latticePoints: [],
    selectedPointIndices: [],
  });

  const [refBlocks, setRefBlocks] = useState<RefBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [gridSnap, setGridSnapState] = useState<SnapSettings>({ enabled: false, value: 100 });
  const [scaleSnap, setScaleSnapState] = useState<SnapSettings>({ enabled: false, value: 100 });
  const [rotateSnap, setRotateSnapState] = useState<SnapSettings>({ enabled: false, value: 15 });

  const _blockCounter = useRef(0);
  const undoStackRef = useRef<(UndoSnapshot & { _label?: string; _timestamp?: number })[]>([]);
  const redoStackRef = useRef<(UndoSnapshot & { _label?: string; _timestamp?: number })[]>([]);

  const captureSnapshot = useCallback((): UndoSnapshot => ({
    position: position.clone(),
    rotation: rotation.clone(),
    scale: scale.clone(),
    pivotOffset: pivotOffset.clone(),
    ffdLatticePoints: ffd.latticePoints.map((p) => p.clone()),
    refBlocks: refBlocks.map((b) => ({ ...b, position: b.position.clone() })),
  }), [position, rotation, scale, pivotOffset, ffd.latticePoints, refBlocks]);

  const rebuildHistory = useCallback(() => {
    setHistoryEntries(
      undoStackRef.current.map((snap, i) => ({
        label: snap._label || `Edit ${i + 1}`,
        timestamp: snap._timestamp || Date.now(),
        snapshot: snap,
      })),
    );
  }, []);

  const pushUndo = useCallback((label?: string) => {
    const snap = captureSnapshot() as UndoSnapshot & { _label?: string; _timestamp?: number };
    snap._label = label || "Edit";
    snap._timestamp = Date.now();
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    rebuildHistory();
  }, [captureSnapshot, rebuildHistory]);

  const restoreSnapshot = useCallback((snap: UndoSnapshot) => {
    setPosition(snap.position.clone());
    setRotation(snap.rotation.clone());
    setScale(snap.scale.clone());
    setPivotOffset(snap.pivotOffset.clone());
    setFFD((f) => ({ ...f, latticePoints: snap.ffdLatticePoints.map((p) => p.clone()) }));
    setRefBlocks(snap.refBlocks.map((b) => ({ ...b, position: b.position.clone() })));
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const current = captureSnapshot() as UndoSnapshot & { _label?: string; _timestamp?: number };
    current._label = "Current";
    current._timestamp = Date.now();
    redoStackRef.current.push(current);
    const snap = undoStackRef.current.pop()!;
    restoreSnapshot(snap);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
    rebuildHistory();
  }, [captureSnapshot, restoreSnapshot, rebuildHistory]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const current = captureSnapshot() as UndoSnapshot & { _label?: string; _timestamp?: number };
    current._label = "Current";
    current._timestamp = Date.now();
    undoStackRef.current.push(current);
    const snap = redoStackRef.current.pop()!;
    restoreSnapshot(snap);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    rebuildHistory();
  }, [captureSnapshot, restoreSnapshot, rebuildHistory]);

  const setModelBBox = useCallback((box: THREE.Box3, size: THREE.Vector3) => {
    setModelBBoxState(box);
    setModelSizeState(size);
  }, []);

  const snapPivotToBottom = useCallback(() => {
    if (!modelBBox) return;
    const center = new THREE.Vector3();
    modelBBox.getCenter(center);
    setPivotOffset(new THREE.Vector3(center.x, modelBBox.min.y, center.z));
  }, [modelBBox]);

  const snapPivotToCenter = useCallback(() => {
    if (!modelBBox) return;
    const center = new THREE.Vector3();
    modelBBox.getCenter(center);
    setPivotOffset(center);
  }, [modelBBox]);

  const centerToOrigin = useCallback(() => {
    setPosition(new THREE.Vector3(0, 0, 0));
  }, []);

  const resetTransform = useCallback(() => {
    setPosition(new THREE.Vector3(0, 0, 0));
    setRotation(new THREE.Euler(0, 0, 0));
    setScale(new THREE.Vector3(1, 1, 1));
  }, []);

  const setToolWithMode = useCallback((tool: EditorTool) => {
    setActiveTool(tool);
    if (tool === "move") setTransformMode("translate");
    else if (tool === "rotate") setTransformMode("rotate");
    else if (tool === "scale") setTransformMode("scale");
  }, []);

  const addRefBlock = useCallback((sizeUU: number) => {
    const id = `block-${Date.now()}-${_blockCounter.current++}`;
    setRefBlocks((prev) => [...prev, { id, sizeUU, position: new THREE.Vector3(0, (sizeUU / 100) / 2, 0), visible: true }]);
    setSelectedBlockId(id);
  }, []);

  const removeRefBlock = useCallback((id: string) => {
    setRefBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedBlockId((cur) => (cur === id ? null : cur));
  }, []);

  const duplicateRefBlock = useCallback((id: string) => {
    setRefBlocks((prev) => {
      const src = prev.find((b) => b.id === id);
      if (!src) return prev;
      const newId = `block-${Date.now()}-${_blockCounter.current++}`;
      const offset = new THREE.Vector3(src.sizeUU / 100, 0, 0);
      const newBlock: RefBlock = { id: newId, sizeUU: src.sizeUU, position: src.position.clone().add(offset), visible: true };
      setSelectedBlockId(newId);
      return [...prev, newBlock];
    });
  }, []);

  const updateRefBlock = useCallback((id: string, patch: Partial<RefBlock>) => {
    setRefBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const toggleBlockVisibility = useCallback((id: string) => {
    setRefBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, visible: !b.visible } : b)));
  }, []);

  const clearAllBlocks = useCallback(() => {
    setRefBlocks([]);
    setSelectedBlockId(null);
  }, []);

  const notifyModelReady = useCallback(() => {
    setModelReady((n) => n + 1);
  }, []);

  const setGridSnap = useCallback((patch: Partial<SnapSettings>) => {
    setGridSnapState((prev) => ({ ...prev, ...patch }));
  }, []);
  const setScaleSnap = useCallback((patch: Partial<SnapSettings>) => {
    setScaleSnapState((prev) => ({ ...prev, ...patch }));
  }, []);
  const setRotateSnap = useCallback((patch: Partial<SnapSettings>) => {
    setRotateSnapState((prev) => ({ ...prev, ...patch }));
  }, []);

  const actions: ModelWorkshopActions = useMemo(() => ({
    setActiveTool: setToolWithMode,
    setTransformMode,
    setPivotOffset,
    snapPivotToBottom,
    snapPivotToCenter,
    centerToOrigin,
    resetTransform,
    setFFDEnabled: (on: boolean) => setFFD((f) => ({ ...f, enabled: on, selectedPointIndices: [] })),
    setFFDDivisions: (d) => setFFD((f) => ({ ...f, divisions: d })),
    setFFDLatticePoints: (pts) => setFFD((f) => ({ ...f, latticePoints: pts })),
    setFFDSelectedPoints: (indices) => setFFD((f) => ({ ...f, selectedPointIndices: indices })),
    toggleFFDPointSelection: (idx) => setFFD((f) => {
      const cur = f.selectedPointIndices;
      return { ...f, selectedPointIndices: cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx] };
    }),
    setPosition: (v) => setPosition(v),
    setRotation: (e) => setRotation(e),
    setScale: (v) => setScale(v),
    setModelBBox,
    setWireframe,
    setShowNormals,
    markDirty: () => {},
    addRefBlock,
    removeRefBlock,
    duplicateRefBlock,
    updateRefBlock,
    setSelectedBlock: setSelectedBlockId,
    toggleBlockVisibility,
    clearAllBlocks,
    setGridSnap,
    setScaleSnap,
    setRotateSnap,
    notifyModelReady,
    setMaterialSlots,
    pushUndo,
    undo,
    redo,
    setShowHistory,
  }), [setToolWithMode, snapPivotToBottom, snapPivotToCenter, centerToOrigin, resetTransform, setModelBBox,
    addRefBlock, removeRefBlock, duplicateRefBlock, updateRefBlock, toggleBlockVisibility, clearAllBlocks,
    setGridSnap, setScaleSnap, setRotateSnap, notifyModelReady, pushUndo, undo, redo]);

  const state: ModelWorkshopState = useMemo(() => ({
    activeTool, transformMode, pivotOffset, ffd,
    position, rotation, scale, modelBBox, modelSize,
    wireframe, showNormals, modelRef, cameraRef, canvasRef,
    modelReady, materialSlots,
    refBlocks, selectedBlockId, gridSnap, scaleSnap, rotateSnap,
    canUndo, canRedo, showHistory, historyEntries,
  }), [activeTool, transformMode, pivotOffset, ffd,
    position, rotation, scale, modelBBox, modelSize,
    wireframe, showNormals, modelReady, materialSlots,
    refBlocks, selectedBlockId,
    gridSnap, scaleSnap, rotateSnap,
    canUndo, canRedo, showHistory, historyEntries]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
