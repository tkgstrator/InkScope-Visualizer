import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, Database, Pause, Play, Radio } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { NavMenu } from "@/components/dashboard/nav-menu"
import { Overlay } from "@/components/dashboard/obs-overlay"
import { type Filter } from "@/components/dashboard/packet-list"
import { SessionStatus } from "@/components/dashboard/session-status"
import { StageMap } from "@/components/dashboard/stage-map"
import { useLiveFeed, useOverlayFeed } from "@/lib/live-feed"
import { replayDelayMs, useReplayArchive } from "@/lib/replay-archive"
import { livePacketRows, packetRowsForEvents } from "@/lib/packet-view"
import { useRecordedSample } from "@/lib/recorded-sample"
import { emptySessionObservation, foldObservationSnapshot } from "@/lib/session-observation"
import { DebugView } from "./debug-view"
import { RawView } from "./raw-view"
import { ReplayView } from "./replay-view"
import { ObsView } from "./obs-view"
import { OverviewView } from "./overview-view"
import { SettingsView } from "./settings-view"
import { demoTime, initialPackets, makePacket, packetTemplates, serverIp, type Packet } from "@/demo-data"

type View = "overview" | "debug" | "raw" | "map" | "replay" | "obs" | "settings"
type Source = "demo" | "live" | "recorded"
const views: View[] = ["overview", "debug", "raw", "map", "replay", "obs", "settings"]
const recordedPageSize = 80
const waveData = [
  { wave: 1, tide: "Low tide", event: "Normal", quota: 21, state: "COMPLETE" },
  { wave: 2, tide: "Normal tide", event: "Event 5", quota: 24, state: "IN PROGRESS" },
  { wave: 3, tide: "High tide", event: "Normal", quota: 26, state: "UP NEXT" },
] as const
export function Dashboard() {
  const query = new URLSearchParams(window.location.search)
  const overlayMode = query.get("view") === "overlay"
  const requestedSource = query.get("source")
  const [source, setSource] = useState<Source>(() => requestedSource === "live" || requestedSource === "demo" ? requestedSource : "recorded")
  const [sampleFallback, setSampleFallback] = useState(false)
  const [view, setView] = useState<View>("overview")
  const [localGameKey, setLocalGameKey] = useState<string | null>(null)
  const [controlKeyState, setControlKeyState] = useState<"absent" | "pending" | "applied" | null>(null)
  const [controlKeyLocked, setControlKeyLocked] = useState(false)
  const [packets, setPackets] = useState<Packet[]>(initialPackets)
  const [selectedId, setSelectedId] = useState("487")
  const [recordedPage, setRecordedPage] = useState(0)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [paused, setPaused] = useState(false)
  const [tick, setTick] = useState(0)
  const [total, setTotal] = useState(8)
  const [authenticated, setAuthenticated] = useState(7)
  const [clock, setClock] = useState(demoTime())
  const [wave, setWave] = useState(2)
  const [replayPosition, setReplayPosition] = useState(() => requestedSource === "demo" ? 45 : 0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [verticalNav, setVerticalNav] = useState(() => window.matchMedia("(min-width: 1280px)").matches)
  const nextRecord = useRef(488)
  const searchRef = useRef<HTMLInputElement>(null)
  const liveFeed = useLiveFeed(source === "live" && !overlayMode)
  const overlayFeed = useOverlayFeed(source === "live" && overlayMode)
  const recordedSample = useRecordedSample(source === "recorded")
  const recordedEvents = recordedSample.status === "ready" ? recordedSample.events : []
  const recordedObservation = useMemo(() => foldObservationSnapshot(emptySessionObservation(), recordedEvents), [recordedEvents])
  const recordedPageCount = Math.max(1, Math.ceil(recordedEvents.length / recordedPageSize))
  const recordedPageIndex = Math.min(recordedPage, recordedPageCount - 1)
  const recordedEnd = Math.max(0, recordedEvents.length - recordedPageIndex * recordedPageSize)
  const recordedStart = Math.max(0, recordedEnd - recordedPageSize)
  const recordedWindow = useMemo(() => recordedEvents.slice(recordedStart, recordedEnd), [recordedEvents, recordedStart, recordedEnd])
  const recordedPackets = useMemo(() => packetRowsForEvents(recordedWindow), [recordedWindow])
  const livePackets = useMemo(() => livePacketRows(liveFeed.events), [liveFeed.events])
  const replayArchive = useReplayArchive(
    view === "replay" && (source === "live" && liveFeed.persistence === "postgres" || source === "recorded" && recordedSample.status === "ready"),
    source === "recorded" ? recordedSample.sessionId : null,
    source === "recorded" ? recordedSample.afterRecord : null,
    source === "recorded" ? recordedSample.startIndex ?? 0 : 0,
  )
  const activePackets = source === "demo" ? packets : source === "live" ? livePackets : recordedPackets
  const observation = source === "recorded" ? recordedObservation : liveFeed.observation
  const visibleEvents = source === "recorded" ? recordedEvents : liveFeed.events
  const chooseSource = (next: Source) => {
    const url = new URL(window.location.href)
    url.searchParams.set("source", next)
    window.history.replaceState(null, "", url)
    setSource(next)
    setSampleFallback(false)
    setSelectedId("")
    setRecordedPage(0)
    setReplayPosition(next === "demo" ? 45 : 0)
    setReplayPlaying(false)
  }
  const reportControlState = useCallback((keyState: "absent" | "pending" | "applied" | null, keyLocked: boolean) => {
    setControlKeyState(keyState)
    setControlKeyLocked(keyLocked)
    if (keyLocked || keyState !== "applied" && keyState !== "pending") setLocalGameKey(null)
  }, [])

  useEffect(() => {
    if (requestedSource !== null || source !== "recorded" || recordedSample.status !== "unavailable") return
    setSource("demo")
    setSampleFallback(true)
  }, [recordedSample.status, requestedSource, source])

  useEffect(() => {
    if (overlayMode || view === "settings") return
    const controller = new AbortController()
    const refresh = () => {
      void fetch("/api/control/status", { signal: controller.signal, cache: "no-store" })
        .then(async (response) => response.ok ? response.json() as Promise<{ state?: string; key_state?: "absent" | "pending" | "applied"; key_locked?: boolean }> : null)
        .then((status) => {
          if (controller.signal.aborted) return
          const locked = status?.state === "reachable" && status.key_locked === true
          setControlKeyState(status?.state === "reachable" ? status.key_state ?? null : null)
          setControlKeyLocked(locked)
          if (locked || status?.state !== "reachable" || status.key_state !== "applied" && status.key_state !== "pending") setLocalGameKey(null)
        })
        .catch(() => { if (!controller.signal.aborted) { setControlKeyState(null); setControlKeyLocked(false); setLocalGameKey(null) } })
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [overlayMode, view])

  useEffect(() => {
    document.documentElement.classList.add("dark")
    const timer = window.setInterval(() => setClock(demoTime()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)")
    const update = () => setVerticalNav(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (paused || source !== "demo") return
    const timer = window.setInterval(() => {
      const id = nextRecord.current++
      const template = packetTemplates[id % packetTemplates.length]!
      setPackets((current) => [makePacket(id, template), ...current].slice(0, 80))
      setTotal(id - 479)
      if (template.status !== "authentication_failed") setAuthenticated((current) => current + 1)
      setTick((current) => current + 1)
    }, 1800)
    return () => window.clearInterval(timer)
  }, [paused, source])

  useEffect(() => {
    if (!replayPlaying) return
    if (source === "demo") {
      if (replayPosition >= 100) { setReplayPlaying(false); return }
      const timer = window.setTimeout(() => setReplayPosition((current) => current + 1), 250)
      return () => window.clearTimeout(timer)
    }
    if (replayArchive.loading) return
    const events = replayArchive.selectedEvents
    if (replayArchive.error || events.length === 0) {
      setReplayPlaying(false)
      return
    }
    if (replayPosition >= events.length - 1) {
      if (!replayArchive.hasMore) { setReplayPlaying(false); return }
      const lastEvent = events.at(-1)!
      const delay = replayArchive.nextEvent ? replayDelayMs([lastEvent, replayArchive.nextEvent], 0) ?? 50 : 50
      const timer = window.setTimeout(() => {
        setReplayPosition(0)
        replayArchive.loadMore()
      }, delay)
      return () => window.clearTimeout(timer)
    }
    const delay = replayDelayMs(events, replayPosition)
    if (delay === null) { setReplayPlaying(false); return }
    const timer = window.setTimeout(() => setReplayPosition((current) => current + 1), delay)
    return () => window.clearTimeout(timer)
  }, [replayPlaying, replayPosition, source, replayArchive.selectedEvents, replayArchive.loading,
    replayArchive.error, replayArchive.hasMore, replayArchive.nextEvent, replayArchive.loadMore])

  const selectReplaySession = (sessionId: string) => {
    replayArchive.selectSession(sessionId)
    setReplayPosition(0)
    setReplayPlaying(false)
  }

  const filtered = useMemo(() => activePackets.filter((packet) => {
    const matchesStatus = filter === "all" || filter === "failed" && (packet.status.includes("fail") || packet.status === "malformed") ||
      filter === "authenticated" && (packet.status === "authenticated" || packet.status === "proof_verified")
    const text = `${packet.id} ${packet.protocol} ${packet.kind} ${packet.source} ${packet.destination} ${packet.status}`.toLowerCase()
    return matchesStatus && text.includes(search.toLowerCase())
  }), [activePackets, search, filter])
  const selected = activePackets.find((packet) => packet.id === selectedId) ?? activePackets[0]
  const selectedIdForView = selected?.id ?? ""
  const serverRtt = (38.2 + Math.sin(tick / 3) * 3.4).toFixed(1)
  const clientRtt = (42.6 + Math.cos(tick / 4) * 4.1).toFixed(1)
  const liveTotal = liveFeed.observation.observedRecords
  const liveAuthenticated = liveFeed.observation.authenticatedRecords
  const delayedClients = liveFeed.observation.clients.filter((client) => client.delay !== null)
  const liveDelay = delayedClients.length === 1 ? delayedClients[0]!.delay :
    liveFeed.observation.host === null ? liveFeed.observation.pairDelay : null
  const recordedDelayedClients = recordedObservation.clients.filter((client) => client.delay !== null)
  const recordedDelay = recordedDelayedClients.length === 1 ? recordedDelayedClients[0]!.delay :
    recordedObservation.host === null ? recordedObservation.pairDelay : null
  const recordedAuthenticated = recordedEvents.filter((event) => event.rows.some((row) => row.status === "authenticated" || row.status === "proof_verified")).length
  const obsUrl = window.location.origin + window.location.pathname + (source === "demo" ? `?view=overlay&source=demo&wave=${wave}` : `?view=overlay&source=${source}`)
  const selectedWave = waveData.find((item) => item.wave === wave) ?? waveData[1]
  const requestedWave = Number(new URLSearchParams(window.location.search).get("wave"))
  const overlayWave = [1, 2, 3].includes(requestedWave) ? requestedWave : wave

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const onPage = event.target === document.body
      const onNavTab = event.target instanceof Element && event.target.closest('[role="tab"]') !== null
      if (!onPage && !onNavTab) return
      const number = Number(event.key)
      if (number >= 1 && number <= views.length) setView(views[number - 1]!)
      if (event.key === " " && onPage && source === "demo") {
        event.preventDefault()
        setPaused((current) => !current)
      }
      if (event.key === "/" && (view === "debug" || view === "raw")) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (onPage && (event.key === "ArrowUp" || event.key === "ArrowDown") && (view === "debug" || view === "raw")) {
        const index = filtered.findIndex((packet) => packet.id === selectedId)
        const next = Math.min(filtered.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))
        if (filtered[next]) { event.preventDefault(); setSelectedId(filtered[next].id) }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [filtered, selectedId, source, view])

  if (overlayMode) return <Overlay serverRtt={serverRtt} clientRtt={clientRtt} wave={overlayWave} quota={(waveData.find((item) => item.wave === overlayWave) ?? waveData[1]).quota} source={source} liveFeed={overlayFeed} recordedObservation={recordedObservation} recordedEvent={recordedEvents.at(-1)} />

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground max-xl:h-auto max-xl:overflow-visible">
      <header className="flex h-16 items-center justify-between border-b bg-sidebar px-5">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-sm border"><Activity className="size-4" /></div>
          <div className="text-base font-semibold tracking-tight">InkScope <span className="font-normal text-muted-foreground">Visualizer</span></div>
        </div>
        <div className="flex items-center gap-3">
          {source === "demo" && <Button size="icon" variant="outline" className="rounded-sm sm:w-auto sm:px-3" aria-label={paused ? "Resume demo" : "Pause demo"} onClick={() => setPaused((current) => !current)}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}<span className="hidden sm:inline">{paused ? "Resume demo" : "Pause demo"}</span></Button>}
          <Button size="icon" variant="ghost" className="rounded-sm sm:w-auto sm:px-3" aria-label="Switch to recorded sample" aria-pressed={source === "recorded"} onClick={() => chooseSource("recorded")}><Database className="size-3.5" /><span className="hidden sm:inline">RECORDED</span></Button>
          <Button size="icon" variant="ghost" className="rounded-sm sm:w-auto sm:px-3" aria-label="Switch to live feed" aria-pressed={source === "live"} onClick={() => chooseSource("live")}><Radio className="size-3.5" /><span className="hidden sm:inline">LIVE</span></Button>
          <Button size="icon" variant="ghost" className="rounded-sm sm:w-auto sm:px-3" aria-label="Switch to demo feed" aria-pressed={source === "demo"} onClick={() => chooseSource("demo")}><Play className="size-3.5" /><span className="hidden sm:inline">DEMO</span></Button>
          <Badge variant="outline" className="hidden rounded-sm font-mono text-xs sm:inline-flex">{source === "demo" ? sampleFallback ? "SYNTHETIC · NO SAMPLE" : "SYNTHETIC DEMO" : source === "live" ? `LIVE ${liveFeed.connection.toUpperCase()}` : recordedSample.status === "ready" ? `RECORDED #${recordedEvents[0]?.record}–#${recordedEvents.at(-1)?.record}` : `RECORDED ${recordedSample.status.toUpperCase()}`}</Badge>
          <Separator orientation="vertical" className="hidden h-5 sm:block" />
          <span className="hidden font-mono text-xs text-muted-foreground sm:block">{clock} JST</span>
        </div>
      </header>

      <Tabs value={view} onValueChange={(value) => setView(value as View)} orientation={verticalNav ? "vertical" : "horizontal"} className="grid h-[calc(100vh-4rem)] grid-cols-[64px_280px_minmax(0,1fr)] gap-0 max-xl:block max-xl:h-auto">
        <NavMenu />
        <SessionStatus serverRtt={serverRtt} clientRtt={clientRtt} wave={wave} quota={selectedWave.quota} source={source} connection={liveFeed.connection} observation={observation} localGameKey={localGameKey} controlKeyState={controlKeyState} controlKeyLocked={controlKeyLocked} />

        <main className={view === "map" ? "h-full min-h-0 min-w-0 overflow-hidden p-0 max-xl:h-[min(78vh,760px)]" : "min-w-0 overflow-y-auto p-6 max-xl:overflow-visible max-sm:p-3"}>
          <div className={view === "map" ? "h-full w-full" : "mx-auto max-w-[1500px]"}>
              {source === "recorded" && (recordedSample.status === "empty" || recordedSample.status === "error" || recordedSample.status === "unavailable") && <div role="alert" className="mb-4 border-b pb-3 font-mono text-xs text-destructive">RECORDED SAMPLE {recordedSample.status.toUpperCase()}{recordedSample.error ? ` · ${recordedSample.error}` : ""}</div>}
              {source === "recorded" && recordedWindow.length > 0 && (view === "debug" || view === "raw") && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-muted-foreground">
                <span>RECORDS #{recordedWindow[0]!.record}–#{recordedWindow.at(-1)!.record} · {recordedPageIndex + 1}/{recordedPageCount}</span>
                <div className="flex gap-2">
                  <Button variant="outline" className="rounded-sm" aria-label="Older recorded packets" disabled={recordedPageIndex >= recordedPageCount - 1} onClick={() => { setRecordedPage((page) => page + 1); setSelectedId("") }}>Older</Button>
                  <Button variant="outline" className="rounded-sm" aria-label="Newer recorded packets" disabled={recordedPageIndex === 0} onClick={() => { setRecordedPage((page) => page - 1); setSelectedId("") }}>Newer</Button>
                </div>
              </div>}
              <TabsContent value="overview">
                <OverviewView
                  source={source}
                  total={source === "demo" ? total : source === "live" ? liveTotal : recordedSample.status === "ready" ? recordedEvents.length : null}
                  authenticated={source === "demo" ? authenticated : source === "live" ? liveAuthenticated : recordedSample.status === "ready" ? recordedAuthenticated : null}
                  clientRtt={source === "demo" ? clientRtt : source === "live" ? liveDelay : recordedDelay}
                  wave={source === "demo" ? wave : null}
                  waves={source === "demo" ? waveData : []}
                  onWaveChange={setWave}
                  serverIp={source === "demo" ? serverIp : undefined}
                  activities={source === "demo" ? undefined : visibleEvents.slice(-8).reverse().map((event) => ({
                    id: `${event.session_id}:${event.record}`,
                    label: event.rows[0]?.kind ?? "UDP",
                    detail: `#${event.record} · ${event.rows[0]?.status ?? "unparsed"}`,
                  }))}
                />
              </TabsContent>

              <TabsContent value="debug">
                <DebugView packets={filtered} selected={selected} selectedId={selectedIdForView} onSelectPacket={setSelectedId} search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} inputRef={searchRef} source={source} />
              </TabsContent>

              <TabsContent value="raw">
                <RawView packets={filtered} selected={selected} selectedId={selectedIdForView} onSelectPacket={setSelectedId} search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} inputRef={searchRef} source={source} />
              </TabsContent>

              <TabsContent value="map" className="m-0 h-full">
                <StageMap tick={tick} source={source} observedStageId={source === "demo" ? null : observation.stageId} observedTide={source === "demo" ? null : observation.tide} connection={liveFeed.connection} />
              </TabsContent>

              <TabsContent value="replay">
                <ReplayView source={source} persistence={source === "recorded" ? recordedSample.status === "ready" ? "postgres" : null : liveFeed.persistence} sessions={replayArchive.sessions} selectedSessionId={replayArchive.selectedSessionId} selectedEvents={replayArchive.selectedEvents} loading={replayArchive.loading} error={replayArchive.error} hasMore={replayArchive.hasMore} hasPrevious={replayArchive.hasPrevious} pageNumber={replayArchive.pageNumber} pageStartIndex={replayArchive.pageStartIndex} onSelectSession={selectReplaySession} onLoadMore={replayArchive.loadMore} onLoadPrevious={replayArchive.loadPrevious} onJumpToStart={replayArchive.jumpToStart} position={replayPosition} playing={replayPlaying} onPositionChange={setReplayPosition} onPlayingChange={setReplayPlaying} />
              </TabsContent>

              <TabsContent value="obs">
                <ObsView wave={source === "demo" ? wave : null} source={source} overlayUrl={obsUrl} />
              </TabsContent>

              <TabsContent value="settings">
                <SettingsView onGameKeyConnected={(key) => { setLocalGameKey(key); setControlKeyLocked(false); chooseSource("live") }} onControlConnected={() => { setLocalGameKey(null); chooseSource("live") }} onDisconnected={() => { setLocalGameKey(null); setControlKeyState("absent"); setControlKeyLocked(false) }} onStatus={reportControlState} />
              </TabsContent>
          </div>
        </main>
      </Tabs>
    </div>
  )
}
