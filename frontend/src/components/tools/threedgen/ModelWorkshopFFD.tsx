import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { useModelWorkshop } from "./ModelWorkshopContext";

/* ── Vertex binding for FFD deformation ────────────────────── */

interface VertexBinding {
  mesh: THREE.Mesh;
  attrIdx: number;
  s: number;
  t: number;
  u: number;
  invWorldMatrix: THREE.Matrix4;
}

function createLatticeGrid(
  bbox: THREE.Box3,
  divX: number,
  divY: number,
  divZ: number,
): THREE.Vector3[] {
  const min = bbox.min;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const points: THREE.Vector3[] = [];
  for (let iz = 0; iz <= divZ; iz++) {
    for (let iy = 0; iy <= divY; iy++) {
      for (let ix = 0; ix <= divX; ix++) {
        points.push(new THREE.Vector3(
          min.x + (ix / divX) * size.x,
          min.y + (iy / divY) * size.y,
          min.z + (iz / divZ) * size.z,
        ));
      }
    }
  }
  return points;
}

function computeBindings(
  group: THREE.Group,
  bbox: THREE.Box3,
  divX: number,
  divY: number,
  divZ: number,
): VertexBinding[] {
  const min = bbox.min;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const bindings: VertexBinding[] = [];

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geo = child.geometry;
    if (!geo.attributes.position) return;
    const posAttr = geo.attributes.position;
    const worldMat = child.matrixWorld;
    const invWorldMatrix = new THREE.Matrix4().copy(worldMat).invert();

    for (let i = 0; i < posAttr.count; i++) {
      const local = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      const world = local.clone().applyMatrix4(worldMat);
      const s = size.x > 0 ? Math.max(0, Math.min(1, (world.x - min.x) / size.x)) : 0.5;
      const t = size.y > 0 ? Math.max(0, Math.min(1, (world.y - min.y) / size.y)) : 0.5;
      const u = size.z > 0 ? Math.max(0, Math.min(1, (world.z - min.z) / size.z)) : 0.5;
      bindings.push({ mesh: child, attrIdx: i, s, t, u, invWorldMatrix });
    }
  });

  return bindings;
}

/* ── Trilinear interpolation ── */

const _interpResult = new THREE.Vector3();
const _tempA = new THREE.Vector3();
const _tempB = new THREE.Vector3();

function trilinearInterp(
  lattice: THREE.Vector3[],
  divX: number, divY: number, divZ: number,
  s: number, t: number, u: number,
): THREE.Vector3 {
  const ix = Math.min(Math.floor(s * divX), divX - 1);
  const iy = Math.min(Math.floor(t * divY), divY - 1);
  const iz = Math.min(Math.floor(u * divZ), divZ - 1);
  const fx = s * divX - ix;
  const fy = t * divY - iy;
  const fz = u * divZ - iz;

  const idx = (zz: number, yy: number, xx: number) =>
    zz * (divY + 1) * (divX + 1) + yy * (divX + 1) + xx;

  const c000 = lattice[idx(iz, iy, ix)];
  const c100 = lattice[idx(iz, iy, ix + 1)];
  const c010 = lattice[idx(iz, iy + 1, ix)];
  const c110 = lattice[idx(iz, iy + 1, ix + 1)];
  const c001 = lattice[idx(iz + 1, iy, ix)];
  const c101 = lattice[idx(iz + 1, iy, ix + 1)];
  const c011 = lattice[idx(iz + 1, iy + 1, ix)];
  const c111 = lattice[idx(iz + 1, iy + 1, ix + 1)];

  function lerpV(a: THREE.Vector3, b: THREE.Vector3, f: number): THREE.Vector3 {
    _tempA.copy(a).multiplyScalar(1 - f);
    _tempB.copy(b).multiplyScalar(f);
    return _interpResult.copy(_tempA).add(_tempB);
  }

  const c00 = lerpV(c000, c100, fx).clone();
  const c10 = lerpV(c010, c110, fx).clone();
  const c01 = lerpV(c001, c101, fx).clone();
  const c11 = lerpV(c011, c111, fx).clone();
  const c0 = lerpV(c00, c10, fy).clone();
  const c1 = lerpV(c01, c11, fy).clone();
  return lerpV(c0, c1, fz).clone();
}

function applyDeformationDirect(
  lattice: THREE.Vector3[],
  bindings: VertexBinding[],
  divX: number, divY: number, divZ: number,
) {
  if (lattice.length === 0 || bindings.length === 0) return;
  const newLocal = new THREE.Vector3();

  for (const b of bindings) {
    const newWorld = trilinearInterp(lattice, divX, divY, divZ, b.s, b.t, b.u);
    newLocal.copy(newWorld).applyMatrix4(b.invWorldMatrix);
    const posAttr = b.mesh.geometry.attributes.position;
    posAttr.setXYZ(b.attrIdx, newLocal.x, newLocal.y, newLocal.z);
  }

  const seen = new Set<THREE.BufferGeometry>();
  for (const b of bindings) {
    if (!seen.has(b.mesh.geometry)) {
      b.mesh.geometry.attributes.position.needsUpdate = true;
      b.mesh.geometry.computeVertexNormals();
      seen.add(b.mesh.geometry);
    }
  }
}

/* ── R3F Component ─────────────────────────────────────────── */

export default function ModelWorkshopFFD() {
  const { state, actions } = useModelWorkshop();
  const { raycaster, pointer, camera } = useThree();
  const bindingsRef = useRef<VertexBinding[]>([]);
  const latticeRef = useRef<THREE.Vector3[]>([]);
  const pointMeshRefs = useRef<Map<number, THREE.Mesh>>(new Map());
  const draggingRef = useRef<{
    selectedIndices: number[];
    plane: THREE.Plane;
    startPositions: Map<number, THREE.Vector3>;
    startIntersection: THREE.Vector3;
  } | null>(null);
  const prevPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const needsCommitRef = useRef(false);

  const { enabled, divisions, latticePoints, selectedPointIndices } = state.ffd;
  const { x: divX, y: divY, z: divZ } = divisions;

  useEffect(() => {
    latticeRef.current = latticePoints.map((p) => p.clone());
  }, [latticePoints]);

  useEffect(() => {
    if (!enabled || !state.modelRef.current || !state.modelBBox) {
      bindingsRef.current = [];
      latticeRef.current = [];
      return;
    }
    const grid = createLatticeGrid(state.modelBBox, divX, divY, divZ);
    latticeRef.current = grid.map((p) => p.clone());
    actions.setFFDLatticePoints(grid);
    bindingsRef.current = computeBindings(state.modelRef.current, state.modelBBox, divX, divY, divZ);
  }, [enabled, divX, divY, divZ, state.modelBBox]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = useCallback((idx: number, shiftKey: boolean) => {
    let indices: number[];
    if (shiftKey) {
      actions.toggleFFDPointSelection(idx);
      indices = selectedPointIndices.includes(idx)
        ? selectedPointIndices.filter((i) => i !== idx)
        : [...selectedPointIndices, idx];
    } else {
      actions.setFFDSelectedPoints([idx]);
      indices = [idx];
    }
    actions.pushUndo("FFD deform");

    const liveLattice = latticeRef.current;
    if (indices.length === 0 || !liveLattice[idx]) return;

    raycaster.setFromCamera(pointer, camera);
    const anchorPoint = liveLattice[idx];
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(),
      anchorPoint,
    );
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);

    const startPositions = new Map<number, THREE.Vector3>();
    for (const i of indices) {
      if (liveLattice[i]) startPositions.set(i, liveLattice[i].clone());
    }

    draggingRef.current = {
      selectedIndices: indices,
      plane,
      startPositions,
      startIntersection: intersection.clone(),
    };
    prevPointerRef.current = { x: pointer.x, y: pointer.y };
  }, [selectedPointIndices, raycaster, pointer, camera, actions]);

  useFrame(() => {
    if (!draggingRef.current) return;
    if (
      Math.abs(pointer.x - prevPointerRef.current.x) < 0.0001 &&
      Math.abs(pointer.y - prevPointerRef.current.y) < 0.0001
    ) return;
    prevPointerRef.current = { x: pointer.x, y: pointer.y };

    const { selectedIndices, plane, startPositions, startIntersection } = draggingRef.current;
    raycaster.setFromCamera(pointer, camera);
    const currentIntersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, currentIntersection);
    const delta = currentIntersection.sub(startIntersection);

    const liveLattice = latticeRef.current;
    for (const idx of selectedIndices) {
      const startPos = startPositions.get(idx);
      if (startPos && liveLattice[idx]) {
        liveLattice[idx].copy(startPos).add(delta);
        const mesh = pointMeshRefs.current.get(idx);
        if (mesh) mesh.position.copy(liveLattice[idx]);
      }
    }
    applyDeformationDirect(liveLattice, bindingsRef.current, divX, divY, divZ);
    needsCommitRef.current = true;
  });

  useEffect(() => {
    const handleUp = () => {
      if (draggingRef.current && needsCommitRef.current) {
        actions.setFFDLatticePoints(latticeRef.current.map((p) => p.clone()));
        actions.markDirty();
        needsCommitRef.current = false;
      }
      draggingRef.current = null;
    };
    window.addEventListener("pointerup", handleUp);
    return () => window.removeEventListener("pointerup", handleUp);
  }, [actions]);

  const wireLines = useMemo(() => {
    if (latticePoints.length === 0) return [];
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    const idx = (z: number, y: number, x: number) => z * (divY + 1) * (divX + 1) + y * (divX + 1) + x;

    for (let z = 0; z <= divZ; z++) {
      for (let y = 0; y <= divY; y++) {
        for (let x = 0; x <= divX; x++) {
          const i = idx(z, y, x);
          if (x < divX) lines.push([latticePoints[i], latticePoints[idx(z, y, x + 1)]]);
          if (y < divY) lines.push([latticePoints[i], latticePoints[idx(z, y + 1, x)]]);
          if (z < divZ) lines.push([latticePoints[i], latticePoints[idx(z + 1, y, x)]]);
        }
      }
    }
    return lines;
  }, [latticePoints, divX, divY, divZ]);

  const selectedSet = useMemo(() => new Set(selectedPointIndices), [selectedPointIndices]);

  if (!enabled || latticePoints.length === 0) return null;

  return (
    <group>
      {wireLines.map(([a, b], i) => (
        <Line key={`lw-${i}`} points={[a.toArray(), b.toArray()]} color="#ff6e40" lineWidth={1} transparent opacity={0.4} />
      ))}
      {latticePoints.map((pt, i) => {
        const isSelected = selectedSet.has(i);
        return (
          <mesh
            key={`lp-${i}`}
            ref={(m) => { if (m) pointMeshRefs.current.set(i, m); else pointMeshRefs.current.delete(i); }}
            position={[pt.x, pt.y, pt.z]}
            onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(i, e.nativeEvent.shiftKey); }}
          >
            <sphereGeometry args={[0.04, 10, 10]} />
            <meshBasicMaterial color={isSelected ? "#ffeb3b" : "#ff6e40"} transparent opacity={isSelected ? 1 : 0.7} />
          </mesh>
        );
      })}
    </group>
  );
}
