import { useRef, useState, useCallback, useMemo } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { useModelWorkshop, type RefBlock } from "./ModelWorkshopContext";

const UU_PER_UNIT = 100;

function snapValue(v: number, snapUU: number): number {
  const snapThree = snapUU / UU_PER_UNIT;
  return Math.round(v / snapThree) * snapThree;
}

function BlockLabel({ text, position, rotation, fontSize }: {
  text: string;
  position: [number, number, number];
  rotation: [number, number, number];
  fontSize: number;
}) {
  return (
    <Text
      position={position}
      rotation={rotation}
      fontSize={fontSize}
      color="#111"
      fontWeight={700}
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.01}
      outlineColor="#999"
    >
      {text}
    </Text>
  );
}

function RefBlockMesh({ block }: { block: RefBlock }) {
  const { state, actions } = useModelWorkshop();
  const meshRef = useRef<THREE.Mesh>(null);
  const [dragging, setDragging] = useState(false);
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const dragOffsetRef = useRef(new THREE.Vector3());
  const { camera, gl } = useThree();

  const sizeThree = block.sizeUU / UU_PER_UNIT;
  const half = sizeThree / 2;
  const isSelected = state.selectedBlockId === block.id;
  const label = `${block.sizeUU}×${block.sizeUU}`;
  const labelSize = Math.max(0.2, sizeThree * 0.14);
  const canDrag = state.activeTool === "move" && isSelected;

  const edgesGeo = useMemo(() => new THREE.BoxGeometry(sizeThree, sizeThree, sizeThree), [sizeThree]);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    actions.setSelectedBlock(block.id);

    if (state.activeTool !== "move") return;
    actions.pushUndo("Move ref block");

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const rect = gl.domElement.getBoundingClientRect();
    ndc.x = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    dragPlaneRef.current.set(new THREE.Vector3(0, 1, 0), -block.position.y);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlaneRef.current, hit);
    if (hit) dragOffsetRef.current.copy(block.position).sub(hit);

    setDragging(true);
    gl.domElement.setPointerCapture(e.nativeEvent.pointerId);
  }, [block.id, block.position, state.activeTool, actions, camera, gl]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragging || !canDrag) return;
    e.stopPropagation();

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const rect = gl.domElement.getBoundingClientRect();
    ndc.x = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlaneRef.current, hit);
    if (!hit) return;

    const newPos = hit.add(dragOffsetRef.current);
    if (state.gridSnap.enabled) {
      newPos.x = snapValue(newPos.x, state.gridSnap.value);
      newPos.z = snapValue(newPos.z, state.gridSnap.value);
    }
    actions.updateRefBlock(block.id, { position: newPos });
  }, [dragging, canDrag, block.id, state.gridSnap, actions, camera, gl]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    e.stopPropagation();
    setDragging(false);
    gl.domElement.releasePointerCapture(e.nativeEvent.pointerId);
  }, [dragging, gl]);

  if (!block.visible) return null;

  return (
    <group position={[block.position.x, block.position.y, block.position.z]}>
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <boxGeometry args={[sizeThree, sizeThree, sizeThree]} />
        <meshStandardMaterial
          color={isSelected ? "#e8e0ff" : "#e0e0e0"}
          transparent
          opacity={isSelected ? 0.5 : 0.35}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[edgesGeo]} />
        <lineBasicMaterial color={isSelected ? "#ff6e40" : "#777"} linewidth={1} />
      </lineSegments>
      <BlockLabel text={label} fontSize={labelSize} position={[0, 0, half + 0.01]} rotation={[0, 0, 0]} />
      <BlockLabel text={label} fontSize={labelSize} position={[0, 0, -(half + 0.01)]} rotation={[0, Math.PI, 0]} />
      <BlockLabel text={label} fontSize={labelSize} position={[half + 0.01, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      <BlockLabel text={label} fontSize={labelSize} position={[-(half + 0.01), 0, 0]} rotation={[0, -Math.PI / 2, 0]} />
      <BlockLabel text={label} fontSize={labelSize} position={[0, half + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <BlockLabel text={label} fontSize={labelSize} position={[0, -(half + 0.01), 0]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

export default function ModelWorkshopRefBlocks() {
  const { state } = useModelWorkshop();
  return (
    <>
      {state.refBlocks.map((block) => (
        <RefBlockMesh key={block.id} block={block} />
      ))}
    </>
  );
}

