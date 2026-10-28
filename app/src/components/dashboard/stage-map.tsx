import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { RotateCcw, RotateCw, ScanEye, ZoomIn, ZoomOut } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AxisView } from "./camera-presets"
import { markerKind, markerLegend, type MarkerKind } from "./marker-style"
import { stagePoints } from "./stage-data"
import type { CameraAction, StaticMarker } from "./stage-viewer"
import type { ReplaySpawn } from "@/lib/replay-game-state"

const StageViewer = lazy(() => import("./stage-viewer").then((module) => ({ default: module.StageViewer })))
const axes: AxisView[] = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]
type MarkerLayer = "Cmn" | "High" | "Mid" | "Low" | "All"
type TerrainState = "checking" | "absent" | "loading" | "ready" | "failed"
type TideLayer = Exclude<MarkerLayer, "Cmn" | "All">
type CatalogStage = {
  stageId: string
  markersUrl: string
  enemyAnchorsUrl: string
  modelUrl: string | null
  modelStageId: string
  waterLevelLocators: Record<TideLayer, { y: number | null }>
}
const layerOptions: { value: MarkerLayer; label: string }[] = [
  { value: "All", label: "All layers" },
  { value: "Cmn", label: "Common only" },
  { value: "Low", label: "Low tide" },
  { value: "Mid", label: "Normal tide" },
  { value: "High", label: "High tide" },
]
const defaultMarkerKinds = markerLegend.slice(0, 6).map((item) => item.kind)

function inLayer(marker: StaticMarker, layer: MarkerLayer): boolean {
  return layer === "All" || marker.layer === "Cmn" || marker.layer === layer
}

function isCatalogStage(value: unknown): value is CatalogStage {
  if (typeof value !== "object" || value === null) return false
  const stage = value as Partial<CatalogStage>
  return typeof stage.stageId === "string"
    && typeof stage.markersUrl === "string"
    && typeof stage.enemyAnchorsUrl === "string"
    && (stage.modelUrl === null || typeof stage.modelUrl === "string")
    && typeof stage.modelStageId === "string"
    && ["Low", "Mid", "High"].every((layer) => {
      const y = stage.waterLevelLocators?.[layer as TideLayer]?.y
      return y === null || typeof y === "number" && Number.isFinite(y)
    })
}

function isStaticMarker(value: unknown): value is StaticMarker {
  if (typeof value !== "object" || value === null) return false
  const marker = value as Partial<StaticMarker>
  return typeof marker.actor === "string"
    && typeof marker.layer === "string"
    && Array.isArray(marker.position)
    && marker.position.length === 3
    && marker.position.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    && markerKind(marker.actor) !== null
}

class ViewerBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("webgl2")
    context?.getExtension("WEBGL_lose_context")?.loseContext()
    return Boolean(context)
  } catch {
    return false
  }
}

export function StageMap({ tick, source, observedStageId, observedTide, connection = "connected", presentation = "full", replaySpawns = [], resetEpoch = 0 }: {
  tick: number
  source: "demo" | "live" | "replay" | "recorded"
  observedStageId?: string | null
  observedTide?: TideLayer | null
  connection?: "idle" | "connecting" | "connected" | "disconnected"
  presentation?: "full" | "replay"
  replaySpawns?: ReplaySpawn[]
  resetEpoch?: number
}) {
  const [catalog, setCatalog] = useState<CatalogStage[]>([])
  const [catalogError, setCatalogError] = useState(false)
  const [selectedStageId, setSelectedStageId] = useState(() => presentation === "replay" ? observedStageId ?? "" : "Cop_Shakedent")
  const [stageOrigin, setStageOrigin] = useState<"manual" | "observed" | "previous">("manual")
  const selectedStage = catalog.find((stage) => stage.stageId === selectedStageId) ?? null
  const points = useMemo(() => source === "demo" && selectedStageId === "Cop_Shakedent" ? stagePoints(tick) : [], [source, selectedStageId, tick])
  const players = points.filter((point) => point.kind === "player")
  const [selectedPlayer, setSelectedPlayer] = useState(players[0]?.name ?? "")
  const [characterMode, setCharacterMode] = useState(false)
  const [activeView, setActiveView] = useState<AxisView | "home" | null>("home")
  const [action, setAction] = useState<CameraAction>({ kind: "home", sequence: 0 })
  const [markers, setMarkers] = useState<StaticMarker[]>([])
  const [extraMarkers, setExtraMarkers] = useState<StaticMarker[]>([])
  const [markersLoaded, setMarkersLoaded] = useState(false)
  const [extraLoaded, setExtraLoaded] = useState(false)
  const [markerError, setMarkerError] = useState(false)
  const [extraError, setExtraError] = useState(false)
  const [markerLayer, setMarkerLayer] = useState<MarkerLayer>("All")
  const [visibleKinds, setVisibleKinds] = useState<Set<MarkerKind>>(() => new Set(defaultMarkerKinds))
  const [selectedMarker, setSelectedMarker] = useState<StaticMarker | null>(null)
  const [terrainState, setTerrainState] = useState<TerrainState>("checking")
  const [webgl] = useState(supportsWebGL)
  const sequence = useRef(0)
  const previousResetEpoch = useRef(resetEpoch)
  const currentStageId = useRef(selectedStageId)
  currentStageId.current = selectedStageId
  const character = characterMode ? players.find((point) => point.name === selectedPlayer) ?? null : null
  const allMarkers = useMemo(() => [...markers, ...extraMarkers], [markers, extraMarkers])
  const visibleMarkers = useMemo(() => allMarkers.filter((marker) => {
    const kind = markerKind(marker.actor)
    return kind !== null && visibleKinds.has(kind) && inLayer(marker, markerLayer)
  }), [allMarkers, markerLayer, visibleKinds])
  const displayMarkers = useMemo(() => presentation === "replay"
    ? visibleMarkers.filter((marker) => markerKind(marker.actor) === "bank")
    : visibleMarkers, [presentation, visibleMarkers])
  const visibleReplaySpawns = useMemo(() => source === "replay" && presentation === "replay"
    ? replaySpawns.filter((spawn) => spawn.position.length === 3 && spawn.position.every(Number.isFinite))
    : [], [source, presentation, replaySpawns])
  const tide = markerLayer === "Low" || markerLayer === "Mid" || markerLayer === "High" ? markerLayer : null
  const waterY = tide ? selectedStage?.waterLevelLocators[tide].y ?? null : null
  const cameraReady = webgl && selectedStage !== null && markersLoaded

  function chooseStage(stageId: string, origin: "manual" | "observed" = "manual") {
    setStageOrigin(origin)
    if (stageId === selectedStageId) return
    setTerrainState("checking")
    setMarkers([])
    setExtraMarkers([])
    setMarkersLoaded(false)
    setExtraLoaded(false)
    setMarkerLayer("All")
    setSelectedMarker(null)
    setSelectedStageId(stageId)
  }

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/maps/stages.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Map catalog: HTTP ${response.status}`)
        return response.json() as Promise<{ stages?: unknown[] }>
      })
      .then((data) => {
        if (!Array.isArray(data.stages) || !data.stages.every(isCatalogStage)) throw new Error("Map catalog invalid")
        setCatalog(data.stages)
        if (presentation !== "replay" && !data.stages.some((stage) => stage.stageId === selectedStageId)) chooseStage(data.stages[0]?.stageId ?? "")
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return
        setCatalogError(true)
        setMarkerError(true)
        setMarkersLoaded(true)
        setExtraLoaded(true)
        setTerrainState("absent")
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (source === "demo") return
    if (presentation === "replay") {
      if (observedStageId) chooseStage(observedStageId, "observed")
      return
    }
    if (observedStageId && catalog.some((stage) => stage.stageId === observedStageId)) chooseStage(observedStageId, "observed")
    else setStageOrigin((current) => current === "observed" ? "previous" : current)
  }, [catalog, observedStageId, source, presentation])

  useEffect(() => {
    if (!selectedStage) return
    const controller = new AbortController()
    sequence.current = 0
    setAction({ kind: "home", sequence: 0 })
    setActiveView("home")
    setCharacterMode(false)
    setSelectedPlayer(source === "demo" && selectedStage.stageId === "Cop_Shakedent" ? stagePoints(0).find((point) => point.kind === "player")?.name ?? "" : "")
    setMarkerLayer("All")
    setSelectedMarker(null)
    setMarkers([])
    setExtraMarkers([])
    setMarkersLoaded(false)
    setExtraLoaded(false)
    setMarkerError(false)
    setExtraError(false)
    setTerrainState("checking")

    void fetch(selectedStage.markersUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Map markers: HTTP ${response.status}`)
        return response.json() as Promise<{ stageId?: string; markers?: unknown[] }>
      })
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.stageId !== selectedStage.stageId || !Array.isArray(data.markers)) throw new Error("Map marker data invalid")
        setMarkers(data.markers.filter(isStaticMarker))
        setMarkersLoaded(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof Error && error.name === "AbortError") return
        setMarkerError(true)
        setMarkersLoaded(true)
      })

    void fetch(selectedStage.enemyAnchorsUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Enemy anchors: HTTP ${response.status}`)
        return response.json() as Promise<{ stageId?: string; markers?: unknown[] }>
      })
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.stageId !== selectedStage.stageId || !Array.isArray(data.markers)) throw new Error("Enemy anchor data invalid")
        setExtraMarkers(data.markers.filter(isStaticMarker))
        setExtraLoaded(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof Error && error.name === "AbortError") return
        setExtraError(true)
        setExtraLoaded(true)
      })

    if (selectedStage.modelUrl) {
      void fetch(selectedStage.modelUrl, { method: "HEAD", signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
          setTerrainState(response.ok && !contentType.includes("text/html") ? "loading" : "absent")
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || error instanceof Error && error.name === "AbortError") return
          setTerrainState("failed")
        })
    } else setTerrainState("absent")
    return () => controller.abort()
  }, [selectedStage, source])

  useEffect(() => {
    if (source === "demo") return
    setMarkerLayer(selectedStage && selectedStage.stageId === observedStageId ? observedTide ?? "All" : "All")
  }, [source, selectedStage, observedStageId, observedTide])

  useEffect(() => {
    if (presentation !== "replay" || previousResetEpoch.current === resetEpoch) return
    previousResetEpoch.current = resetEpoch
    setCharacterMode(false)
    setSelectedMarker(null)
    setActiveView("home")
    setAction({ kind: "home", sequence: ++sequence.current })
  }, [presentation, resetEpoch])

  function viewFrom(axis: AxisView) {
    setCharacterMode(false)
    setActiveView(axis)
    setAction({ kind: "axis", view: axis, sequence: ++sequence.current })
  }

  function homeView() {
    setCharacterMode(false)
    setActiveView("home")
    setAction({ kind: "home", sequence: ++sequence.current })
  }

  function turn(direction: -1 | 1) {
    setCharacterMode(false)
    setActiveView(null)
    setAction({ kind: "turn", direction, sequence: ++sequence.current })
  }

  function zoom(factor: number) {
    setCharacterMode(false)
    setActiveView(null)
    setAction({ kind: "zoom", factor, sequence: ++sequence.current })
  }

  function leaveCharacter() {
    if (!characterMode) return
    setCharacterMode(false)
    setActiveView(null)
    setAction({ kind: "restore", sequence: ++sequence.current })
  }

  function toggleMarkerKind(kind: MarkerKind) {
    setVisibleKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
    setSelectedMarker(null)
  }

  const fallback = <div className="flex h-full items-center justify-center bg-[#111316] font-mono text-xs text-muted-foreground">3D UNAVAILABLE</div>
  const markerStatus = markerError
    ? "STATIC MARKERS UNAVAILABLE"
    : !markersLoaded || !extraLoaded
      ? "LOADING STATIC MARKERS"
      : visibleMarkers.length + "/" + allMarkers.length + " ROMFS MARKERS · " + markerLayer
  const terrainStatus = {
    checking: "CHECKING LOCAL TERRAIN",
    absent: "COORDINATE GRID",
    loading: "LOADING LOCAL TERRAIN",
    ready: "LOCAL STAGE MESH",
    failed: "TERRAIN UNAVAILABLE · GRID",
  }[terrainState]
  const cameraControls = (
    <>
      <div className="flex flex-wrap items-center gap-1" aria-label="Camera controls">
        <Button variant={activeView === "home" && !characterMode ? "secondary" : "outline"} className="rounded-sm font-mono" aria-label="3D orbit view" aria-pressed={activeView === "home" && !characterMode} disabled={!cameraReady} onClick={homeView}>3D</Button>
        {axes.map((axis) => (
          <Button key={axis} variant={activeView === axis && !characterMode ? "secondary" : "outline"} className="rounded-sm font-mono" aria-label={"View from " + axis} aria-pressed={activeView === axis && !characterMode} disabled={!cameraReady} onClick={() => viewFrom(axis)}>{axis}</Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="icon" variant="outline" className="rounded-sm" aria-label="Rotate left 90 degrees" disabled={characterMode || !cameraReady} onClick={() => turn(-1)}><RotateCcw /></Button>
        <Button size="icon" variant="outline" className="rounded-sm" aria-label="Rotate right 90 degrees" disabled={characterMode || !cameraReady} onClick={() => turn(1)}><RotateCw /></Button>
        <Button size="icon" variant="outline" className="rounded-sm" aria-label="Zoom in" disabled={characterMode || !cameraReady} onClick={() => zoom(0.75)}><ZoomIn /></Button>
        <Button size="icon" variant="outline" className="rounded-sm" aria-label="Zoom out" disabled={characterMode || !cameraReady} onClick={() => zoom(1.35)}><ZoomOut /></Button>
      </div>
    </>
  )
  const characterControls = (
    <>
      {players.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
            <SelectTrigger className="w-36 rounded-sm" aria-label="Character"><SelectValue /></SelectTrigger>
            <SelectContent>{players.map((point) => <SelectItem key={point.name} value={point.name}>{point.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant={characterMode ? "secondary" : "outline"} className="rounded-sm" aria-label="Character POV" aria-pressed={characterMode} disabled={!cameraReady} onClick={() => { setCharacterMode(true); setActiveView(null) }}><ScanEye /> POV</Button>
          <Button variant="outline" className="rounded-sm" aria-label="Free camera" disabled={!cameraReady || !characterMode} onClick={leaveCharacter}>Free</Button>
        </div>
      ) : <span className="font-mono text-xs text-muted-foreground">XYZ —</span>}
      {selectedMarker ? (
        <div className="mt-2 border-t pt-2 font-mono text-xs">
          <div className="break-all">ACTOR {selectedMarker.actor}</div>
          <div>LAYER {selectedMarker.layer}</div>
          <div>XYZ {selectedMarker.position.map((value) => value.toFixed(2)).join(" / ")}</div>
        </div>
      ) : players.length > 0 ? (
        <p className="mt-1 font-mono text-xs text-muted-foreground">XYZ {players.find((point) => point.name === selectedPlayer)?.x.toFixed(1)} / {players.find((point) => point.name === selectedPlayer)?.y.toFixed(1)} / {players.find((point) => point.name === selectedPlayer)?.z.toFixed(1)} · DEMO</p>
      ) : null}
    </>
  )

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden bg-[#111316]" role={presentation === "replay" ? "region" : undefined} aria-label={presentation === "replay" ? `Replay map ${selectedStageId || "unknown stage"}` : undefined}>
      <div className="absolute inset-0">
        {webgl ? (
          <ViewerBoundary fallback={fallback}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading 3D viewer…</div>}>
              <StageViewer key={selectedStageId} points={points} markers={displayMarkers} replaySpawns={visibleReplaySpawns} focusMarkers={markers} waterY={waterY} terrainUrl={terrainState === "loading" || terrainState === "ready" ? selectedStage?.modelUrl ?? null : null} terrainReady={terrainState === "ready"} onTerrainState={(state) => { if (currentStageId.current === selectedStageId) setTerrainState(state) }} onMarkerSelect={setSelectedMarker} action={action} character={character} onFreeOrbit={() => setActiveView(null)} />
            </Suspense>
          </ViewerBoundary>
        ) : fallback}
      </div>

      <div className={`pointer-events-none absolute inset-0 z-10 flex flex-col justify-between gap-2 p-3 ${presentation === "replay" ? "max-sm:pt-[292px]" : ""}`}>
        <div className="flex items-start justify-between gap-2 max-sm:flex-col">
          {presentation === "full" && <section className="pointer-events-auto w-[min(310px,100%)] rounded-sm border bg-sidebar/90 p-2 backdrop-blur-md" aria-label="Map status and stage">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Map &amp; position</h2>
              <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">ROMFS · 11.3.0{source === "live" && connection !== "connected" && <Badge variant="outline" className="rounded-sm text-xs">{connection.toUpperCase()}</Badge>}</span>
            </div>
            <label className="mt-2 block font-mono text-xs text-muted-foreground">STAGE</label>
            <Select value={selectedStageId} onValueChange={(value) => chooseStage(value)} disabled={catalog.length === 0}>
              <SelectTrigger className="mt-1 w-full rounded-sm" aria-label="Stage"><SelectValue placeholder="Loading stages…" /></SelectTrigger>
              <SelectContent>{catalog.map((stage) => <SelectItem key={stage.stageId} value={stage.stageId}>{stage.stageId}</SelectItem>)}</SelectContent>
            </Select>
            {source !== "demo" && <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
              <Badge variant="outline" className="rounded-sm text-xs">{stageOrigin === "observed" && selectedStage && selectedStage.stageId === observedStageId ? "OBSERVED STAGE" : stageOrigin === "previous" ? "PREVIOUS STAGE" : "MANUAL STAGE"}</Badge>
              <span className="break-all">{observedStageId ? catalog.some((stage) => stage.stageId === observedStageId) ? `OBSERVED ${observedStageId}` : `OBSERVED ${observedStageId} · NO ROMFS MAP` : "OBSERVED Unknown"}</span>
              {observedTide && <Badge variant="outline" className="rounded-sm text-xs">OBSERVED TIDE {observedTide.toUpperCase()}</Badge>}
            </div>}
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">LAYER</span>
              <Select value={markerLayer} disabled={!selectedStage || !markersLoaded} onValueChange={(value) => { setMarkerLayer(value as MarkerLayer); setSelectedMarker(null) }}>
                <SelectTrigger className="min-w-0 flex-1 rounded-sm" aria-label="Static marker layer"><SelectValue /></SelectTrigger>
                <SelectContent>{layerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="secondary" className="rounded-sm font-mono text-xs">{terrainStatus}</Badge>
              <Badge variant="outline" className="rounded-sm font-mono text-xs">{markerStatus}</Badge>
              {selectedStage && selectedStage.modelStageId !== selectedStage.stageId && <Badge variant="outline" className="rounded-sm font-mono text-xs">MESH: {selectedStage.modelStageId}</Badge>}
              {catalogError && <Badge variant="outline" className="rounded-sm font-mono text-xs">STAGE CATALOG UNAVAILABLE</Badge>}
              {extraError && <Badge variant="outline" className="rounded-sm font-mono text-xs">EXTRA ANCHORS UNAVAILABLE</Badge>}
            </div>
            {selectedStage && tide && <div className="mt-1 flex items-center gap-1 font-mono text-xs text-muted-foreground"><span>{waterY === null ? "WATER —" : "TIDE " + (tide === "Mid" ? "NORMAL" : tide.toUpperCase()) + " · Y " + waterY.toFixed(2)}</span><Badge variant="outline" className="rounded-sm text-xs">FIXED</Badge></div>}
          </section>}

          <section className={`pointer-events-auto hidden w-[min(480px,100%)] rounded-sm border bg-sidebar/90 p-2 backdrop-blur-md sm:block ${presentation === "replay" ? "ml-auto" : ""}`} aria-label="Map camera">
            {cameraControls}
            {presentation === "replay" && <div className="mt-2 flex flex-wrap gap-3 border-t pt-2 font-mono text-xs" aria-label="Replay spawn legend">
              <span className="text-[#ff7056]">ENEMY SPAWN {visibleReplaySpawns.filter((spawn) => spawn.kind === "enemy").length}</span>
              <span className="text-[#f6dc5d]">ITEM SPAWN {visibleReplaySpawns.filter((spawn) => spawn.kind === "item").length}</span>
            </div>}
          </section>
          <details className={`pointer-events-auto rounded-sm border bg-sidebar/90 p-2 backdrop-blur-md sm:hidden ${presentation === "replay" ? "ml-auto w-[min(320px,100%)]" : "w-full"}`}>
            <summary className="cursor-pointer font-mono text-xs">CAMERA · {activeView === "home" ? "3D" : activeView ?? "FREE"}</summary>
            <div className="mt-2">{cameraControls}</div>
            {presentation === "replay" && <div className="mt-2 border-t pt-2 font-mono text-xs" aria-label="Replay spawn legend">ENEMY SPAWN {visibleReplaySpawns.filter((spawn) => spawn.kind === "enemy").length} · ITEM SPAWN {visibleReplaySpawns.filter((spawn) => spawn.kind === "item").length}</div>}
          </details>
        </div>

        {presentation === "full" && <div className="flex flex-wrap items-end justify-between gap-2">
          <details className="pointer-events-auto w-[min(310px,100%)] rounded-sm border bg-sidebar/90 p-2 backdrop-blur-md">
            <summary className="cursor-pointer font-mono text-xs">SHOW MARKERS · {visibleMarkers.length}/{allMarkers.length}</summary>
            <div className="mt-2 grid max-h-[min(30vh,220px)] grid-cols-2 gap-1 overflow-y-auto border-t pt-2" aria-label="Map overlays">
              {markerLegend.map((item) => {
                const count = allMarkers.filter((marker) => markerKind(marker.actor) === item.kind && inLayer(marker, markerLayer)).length
                return <div key={item.kind} className="flex min-h-8 items-center gap-1 font-mono text-xs"><Checkbox id={"overlay-" + item.kind} aria-label={"Show " + item.label} checked={visibleKinds.has(item.kind)} disabled={count === 0} onCheckedChange={() => toggleMarkerKind(item.kind)} /><i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><label htmlFor={"overlay-" + item.kind} className={count === 0 ? "text-muted-foreground" : "cursor-pointer"}>{item.label} <span className="text-muted-foreground">{count}</span></label></div>
              })}
            </div>
          </details>

          <section className="pointer-events-auto hidden max-w-[min(320px,100%)] rounded-sm border bg-sidebar/90 p-2 backdrop-blur-md sm:block" aria-label="Map character">
            {characterControls}
          </section>
          <details className="pointer-events-auto w-full rounded-sm border bg-sidebar/90 p-2 backdrop-blur-md sm:hidden">
            <summary className="cursor-pointer font-mono text-xs">POSITION · {selectedMarker?.actor ?? (players.length ? "DEMO" : "UNAVAILABLE")}</summary>
            <div className="mt-2">{characterControls}</div>
          </details>
        </div>}
      </div>
      {presentation === "replay" && visibleReplaySpawns.length > 0 && <ul className="sr-only" aria-label="Replay spawn locations">
        {visibleReplaySpawns.map((spawn) => <li key={`${spawn.kind}:${spawn.record}`}>
          {spawn.kind === "enemy" ? "Enemy" : "Item"} spawn #{spawn.record} {spawn.actor} XYZ {spawn.position.join(" / ")}
        </li>)}
      </ul>}
    </div>
  )
}
