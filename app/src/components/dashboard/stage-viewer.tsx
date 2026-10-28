import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Edges, OrbitControls, useGLTF } from "@react-three/drei"
import { DoubleSide, Mesh, MeshStandardMaterial, Vector3 } from "three"
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib"
import { axisPose, characterPose, quarterTurn, spectatorPose, type AxisView, type Vec3 } from "./camera-presets"
import type { StagePoint } from "./stage-data"
import { markerColor, markerKind } from "./marker-style"
import type { ReplaySpawn } from "@/lib/replay-game-state"

export type StaticMarker = {
  actor: string
  layer: string
  position: [number, number, number]
}

export type CameraAction =
  | { kind: "home"; sequence: number }
  | { kind: "axis"; view: AxisView; sequence: number }
  | { kind: "turn"; direction: -1 | 1; sequence: number }
  | { kind: "zoom"; factor: number; sequence: number }
  | { kind: "restore"; sequence: number }

class TerrainBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function Terrain({ url, onReady }: { url: string; onReady: (state: "ready") => void }) {
  const gltf = useGLTF(url)
  const material = useMemo(() => new MeshStandardMaterial({ color: "#81909a", roughness: 1, side: DoubleSide }), [])
  const scene = useMemo(() => {
    const copy = gltf.scene.clone(true)
    copy.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = material
        object.receiveShadow = true
      }
    })
    return copy
  }, [gltf.scene, material])

  useEffect(() => {
    onReady("ready")
  }, [onReady])

  useEffect(() => () => material.dispose(), [material])

  return <primitive object={scene} />
}

function CameraRig({ action, character, focus, onFreeOrbit }: {
  action: CameraAction
  character: StagePoint | null
  focus: Vec3
  onFreeOrbit: () => void
}) {
  const controls = useRef<OrbitControlsImpl>(null)
  const savedOrbit = useRef<{ position: Vector3; target: Vector3; up: Vector3 } | null>(null)
  const wasCharacter = useRef(false)
  const eye = useRef(new Vector3())
  const look = useRef(new Vector3())
  const { camera } = useThree()
  const characterEye = useMemo(() => character ? characterPose(character) : null, [character])

  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    if (character) {
      if (!wasCharacter.current) {
        savedOrbit.current = {
          position: camera.position.clone(), target: orbit.target.clone(), up: camera.up.clone(),
        }
      }
      wasCharacter.current = true
      orbit.enabled = false
      return
    }

    orbit.enabled = true
    wasCharacter.current = false
    if (action.kind === "restore" && savedOrbit.current) {
      camera.position.copy(savedOrbit.current.position)
      camera.up.copy(savedOrbit.current.up)
      orbit.target.copy(savedOrbit.current.target)
    } else if (action.kind === "home") {
      const pose = spectatorPose(focus, 200)
      camera.position.set(...pose.position)
      camera.up.set(...pose.up)
      orbit.target.set(...focus)
    } else if (action.kind === "axis") {
      const pose = axisPose(action.view, focus, action.view.endsWith("Y") ? 160 : 125)
      camera.position.set(...pose.position)
      camera.up.set(...pose.up)
      orbit.target.set(...focus)
    } else if (action.kind === "turn") {
      const pose = quarterTurn(
        camera.position.toArray() as [number, number, number],
        orbit.target.toArray() as [number, number, number],
        camera.up.toArray() as [number, number, number],
        action.direction,
      )
      camera.position.set(...pose.position)
      camera.up.set(...pose.up)
    } else if (action.kind === "zoom") {
      const offset = camera.position.clone().sub(orbit.target).multiplyScalar(action.factor)
      offset.clampLength(4, 220)
      camera.position.copy(orbit.target).add(offset)
    }
    orbit.update()
  }, [action, camera, character])

  useEffect(() => {
    const orbit = controls.current
    if (!orbit || action.sequence !== 0 || character) return
    const pose = action.kind === "axis"
      ? axisPose(action.view, focus, action.view.endsWith("Y") ? 160 : 125)
      : spectatorPose(focus, 200)
    camera.position.set(...pose.position)
    camera.up.set(...pose.up)
    orbit.target.set(...focus)
    orbit.update()
  }, [action, camera, character, focus])

  useFrame((_, delta) => {
    if (!characterEye) return
    const amount = 1 - Math.exp(-Math.min(delta, 0.1) * 7)
    camera.position.lerp(eye.current.set(...characterEye.position), amount)
    camera.up.set(0, 1, 0)
    camera.lookAt(look.current.set(...characterEye.target))
  })

  return <OrbitControls ref={controls} enabled={!character} enableDamping minDistance={4} maxDistance={220} onStart={onFreeOrbit} />
}

function ViewerScene({ points, markers, replaySpawns, focusMarkers, waterY, terrainUrl, terrainReady, onTerrainState, onMarkerSelect, action, character, onFreeOrbit }: {
  points: StagePoint[]
  markers: StaticMarker[]
  replaySpawns: ReplaySpawn[]
  focusMarkers: StaticMarker[]
  waterY: number | null
  terrainUrl: string | null
  terrainReady: boolean
  onTerrainState: (state: "ready" | "failed") => void
  onMarkerSelect: (marker: StaticMarker) => void
  action: CameraAction
  character: StagePoint | null
  onFreeOrbit: () => void
}) {
  const focus = useMemo<Vec3>(() => {
    if (focusMarkers.length === 0) return [0, 2, -12]
    const bounds = [0, 1, 2].map((axis) => {
      const values = focusMarkers.map((marker) => marker.position[axis]!)
      return (Math.min(...values) + Math.max(...values)) / 2
    })
    return [bounds[0]!, bounds[1]!, bounds[2]!]
  }, [focusMarkers])
  const waterBounds = useMemo(() => {
    if (focusMarkers.length === 0) return null
    const x = focusMarkers.map((marker) => marker.position[0])
    const z = focusMarkers.map((marker) => marker.position[2])
    const left = Math.min(...x)
    const right = Math.max(...x)
    const near = Math.min(...z)
    const far = Math.max(...z)
    return { x: (left + right) / 2, z: (near + far) / 2, width: right - left + 16, depth: far - near + 16 }
  }, [focusMarkers])

  return (
    <>
      <ambientLight intensity={1.8} />
      <directionalLight position={[40, 80, 30]} intensity={2.5} />
      {!terrainReady && <gridHelper args={[180, 18, "#4b5563", "#2b3038"]} position={[0, -5.6, 0]} />}
      <axesHelper args={[12]} position={[0, 0, 0]} />
      {terrainUrl && <TerrainBoundary key={terrainUrl} onFail={() => onTerrainState("failed")}><Suspense fallback={null}><Terrain url={terrainUrl} onReady={onTerrainState} /></Suspense></TerrainBoundary>}
      {waterY !== null && waterBounds && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[waterBounds.x, waterY, waterBounds.z]}>
          <planeGeometry args={[waterBounds.width, waterBounds.depth]} />
          <meshBasicMaterial color="#53bfff" side={DoubleSide} transparent opacity={0.24} depthWrite={false} />
        </mesh>
      )}
      {markers.map((marker, index) => {
        const kind = markerKind(marker.actor)
        const color = markerColor(marker.actor)
        return (
          <mesh key={`${marker.actor}-${marker.layer}-${index}`} position={marker.position} onClick={(event) => { event.stopPropagation(); onMarkerSelect(marker) }}>
            {kind === "bank" ? <boxGeometry args={[3, 7.2, 3]} /> : <sphereGeometry args={[kind === "start" ? 1 : 0.8, 8, 8]} />}
            <meshStandardMaterial color={kind === "bank" ? "#dce4e9" : color} emissive={kind === "bank" ? "#73808a" : color} emissiveIntensity={kind === "bank" ? 0.14 : 0.25} metalness={kind === "bank" ? 0.2 : 0} roughness={kind === "bank" ? 0.28 : 0.6} />
            {kind === "bank" && <Edges threshold={15} color="#596b77" />}
          </mesh>
        )
      })}
      {replaySpawns.map((spawn) => {
        const color = spawn.kind === "enemy" ? "#ff7056" : "#f6dc5d"
        return <group key={`${spawn.kind}:${spawn.record}`} position={spawn.position}>
          <mesh>
            {spawn.kind === "enemy" ? <octahedronGeometry args={[1.4, 0]} /> : <sphereGeometry args={[1.1, 12, 8]} />}
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} roughness={0.45} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={spawn.kind === "enemy" ? [1.8, 2.5, 24] : [1.5, 2.1, 24]} />
            <meshBasicMaterial color={color} transparent opacity={0.8} side={DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      })}
      {points.filter((point) => point.kind === "player" && point.name !== character?.name).map((point) => (
        <group key={point.name} position={[point.x, point.y, point.z]}>
          <mesh position={[0, 1.3, 0]}>
            <capsuleGeometry args={[1.1, 1.6, 4, 8]} />
            <meshStandardMaterial color={point.color} emissive={point.color} emissiveIntensity={0.32} />
          </mesh>
          <group rotation={[0, (point.yawDeg ?? 0) * Math.PI / 180, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 1.3, 2.1]}>
              <coneGeometry args={[0.55, 1.5, 8]} />
              <meshStandardMaterial color="#ffffff" transparent opacity={0.7} />
            </mesh>
          </group>
        </group>
      ))}
      <CameraRig action={action} character={character} focus={focus} onFreeOrbit={onFreeOrbit} />
    </>
  )
}

export function StageViewer(props: {
  points: StagePoint[]
  markers: StaticMarker[]
  replaySpawns: ReplaySpawn[]
  focusMarkers: StaticMarker[]
  waterY: number | null
  terrainUrl: string | null
  terrainReady: boolean
  onTerrainState: (state: "ready" | "failed") => void
  onMarkerSelect: (marker: StaticMarker) => void
  action: CameraAction
  character: StagePoint | null
  onFreeOrbit: () => void
}) {
  return (
    <div className="h-full w-full overflow-hidden bg-[#111316]" role="img" aria-label={props.replaySpawns.length > 0 ? "3D stage with recorded spawn markers" : props.terrainReady ? "3D local stage terrain with static RomFS markers" : "3D stage coordinate viewer with static RomFS markers"}>
      <Canvas camera={{ position: [100, 90, 100], fov: 52, near: 0.1, far: 4000 }} dpr={[1, 2]}>
        <ViewerScene {...props} />
      </Canvas>
    </div>
  )
}
