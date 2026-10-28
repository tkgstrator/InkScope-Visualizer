import { memo, useEffect, useRef, useState } from "react"
import { Pause, Play, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { FlatCard } from "@/components/dashboard/flat-card"
import { StageMap } from "@/components/dashboard/stage-map"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ReplayGameSnapshot, ReplaySpawn } from "@/lib/replay-game-state"
import type { PacketEnvelope } from "../../../api/wire"

export type ReplaySession = {
  session_id: string
  events: string
  first_timestamp_ns: string
  last_timestamp_ns: string
}

export type ReplayViewProps = {
  source: "demo" | "live" | "replay" | "recorded"
  persistence?: "memory" | "postgres" | null
  sessions: ReplaySession[]
  selectedSessionId: string | null
  selectedEvents: PacketEnvelope[]
  loading: boolean
  error: string | null
  pageStartIndex?: number
  onSelectSession: (sessionId: string) => void
  position: number
  elapsedMs: number
  durationMs: number
  playing: boolean
  onPositionChange: (position: number) => void
  onElapsedChange: (elapsedMs: number) => void
  onPlayingChange: (playing: boolean) => void
  onRestart: () => void
  onRetry?: () => void
  hud: ReplayGameSnapshot
  activeSpawns: ReplaySpawn[]
  keyStatus?: string
}

const captureFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false,
})

function captureTime(timestampNs: string): string {
  try {
    const millis = BigInt(timestampNs) / 1_000_000n
    if (millis < 0n || millis > BigInt(Number.MAX_SAFE_INTEGER)) return timestampNs
    return captureFormatter.format(new Date(Number(millis)))
  } catch {
    return timestampNs
  }
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

function formatElapsed(milliseconds: number): string {
  const tenths = Math.floor(Math.max(0, milliseconds) / 100)
  const seconds = Math.floor(tenths / 10)
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${tenths % 10}`
}

const timelineRowHeight = 32
const timelineViewportHeight = 320
const timelineOverscan = 8

const ReplayTerrain = memo(function ReplayTerrain({ stageId, tide, spawns }: {
  stageId: string
  tide: ReplayGameSnapshot["tide"]
  spawns: ReplaySpawn[]
}) {
  return <StageMap tick={0} source="replay" presentation="replay" observedStageId={stageId} observedTide={tide} replaySpawns={spawns} />
})

export function ReplayView({
  source, persistence = null, sessions, selectedSessionId, selectedEvents, loading, error,
  pageStartIndex = 0, onSelectSession, position, elapsedMs, durationMs, playing,
  onPositionChange, onElapsedChange, onPlayingChange, onRestart, onRetry, hud, activeSpawns, keyStatus = "—",
}: ReplayViewProps) {
  const replaySeconds = Math.floor(position * 1.2)
  const replayTime = `${String(Math.floor(replaySeconds / 60)).padStart(2, "0")}:${String(replaySeconds % 60).padStart(2, "0")}`
  const selectedSession = sessions.find((session) => session.session_id === selectedSessionId)
  const currentIndex = Math.min(Math.max(0, Math.floor(position)), Math.max(0, selectedEvents.length - 1))
  const currentEvent = selectedEvents[currentIndex]
  const firstLoaded = selectedEvents[0]
  const lastLoaded = selectedEvents.at(-1)
  const timelineRef = useRef<HTMLDivElement>(null)
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  const visibleStart = Math.max(0, Math.floor(timelineScrollTop / timelineRowHeight) - timelineOverscan)
  const visibleEnd = Math.min(selectedEvents.length,
    Math.ceil((timelineScrollTop + timelineViewportHeight) / timelineRowHeight) + timelineOverscan)
  const timeline = selectedEvents.slice(visibleStart, visibleEnd)
  const replayCount = selectedSession
    ? (() => { try {
      const count = BigInt(selectedSession.events) - BigInt(pageStartIndex)
      return (count > 0n ? count : 0n).toString()
    } catch { return selectedSession.events } })()
    : "0"
  const captureClock = firstLoaded
    ? captureTime((BigInt(firstLoaded.timestamp_ns) + BigInt(Math.round(Math.max(0, elapsedMs) * 1_000_000))).toString())
    : "—"

  useEffect(() => {
    const element = timelineRef.current
    if (!element || selectedEvents.length === 0) return
    const rowTop = currentIndex * timelineRowHeight
    const viewportHeight = element.clientHeight || timelineViewportHeight
    if (rowTop < element.scrollTop || rowTop + timelineRowHeight > element.scrollTop + viewportHeight) {
      element.scrollTop = Math.max(0, rowTop - Math.floor(viewportHeight / 2))
      setTimelineScrollTop(element.scrollTop)
    }
  }, [currentIndex, selectedEvents.length, selectedSessionId])

  if (source !== "demo") {
    const mapStage = hud.stageId ?? hud.sessionStageId
    const latestActiveSpawn = activeSpawns.at(-1)
    return (
      <div className="relative h-full min-h-[520px] w-full overflow-hidden bg-[#111316]" aria-label="Replay stage">
        <div className="absolute inset-0">
          {mapStage ? <ReplayTerrain stageId={mapStage} tide={hud.tide} spawns={activeSpawns} /> :
            <div className="grid h-full place-items-center font-mono text-xs text-muted-foreground">MAP —</div>}
        </div>

        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between gap-3 p-3 sm:p-4">
          <section className="pointer-events-auto w-full rounded-sm border bg-sidebar/90 p-2 font-mono text-xs backdrop-blur-sm sm:hidden" aria-label="Replay HUD">
            <div className="flex items-center justify-between gap-2">
              <strong className="tracking-widest">REPLAY</strong>
              <time className="min-w-0 truncate text-right tabular-nums">{captureClock} {firstLoaded ? "JST" : ""}</time>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t pt-1">
              <strong className="min-w-0 truncate">{mapStage ?? "STAGE —"}</strong>
              <span className="shrink-0">DIFFICULTY {hud.difficulty ?? "—"}</span>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-x-2 border-t pt-1">
              <span>WAVE {hud.wave ?? "—"}</span><span>TIDE {hud.tide ?? "—"}</span><span>QUOTA {hud.quota ?? "—"}</span>
              <span>ENEMY {hud.enemySpawnCount}</span><span>ITEM {hud.itemSpawnCount}</span><span>KEY {keyStatus}</span>
            </div>
            {latestActiveSpawn && <div className="mt-1 truncate border-t pt-1">{latestActiveSpawn.kind === "enemy" ? "ENEMY" : "ITEM"} · {latestActiveSpawn.actor}</div>}
            <div className="mt-1 flex items-center gap-2 border-t pt-1">
              <Select value={selectedSessionId ?? undefined} onValueChange={onSelectSession} disabled={sessions.length === 0}>
                <SelectTrigger className="h-8 min-w-0 flex-1 rounded-sm font-mono text-xs" aria-label="Replay session">
                  <SelectValue placeholder="SELECT SESSION" />
                </SelectTrigger>
                <SelectContent>{sessions.map((session) => <SelectItem key={session.session_id} value={session.session_id}>
                  {shortSessionId(session.session_id)} · {session.events}
                </SelectItem>)}</SelectContent>
              </Select>
              <span className="shrink-0 text-muted-foreground">{selectedEvents.length} / {replayCount}</span>
            </div>
            <details className="mt-1 border-t pt-1">
              <summary className="cursor-pointer text-muted-foreground">DETAILS</summary>
              <div className="mt-1 grid grid-cols-2 gap-x-2">
                <span>SEQUENCE {hud.sequence ?? "—"}</span><span>JOB {hud.jobType ?? "—"}</span>
                {hud.host ? <>
                  <span>SERVER {hud.host}</span>
                  {hud.clients.map((client) => <span key={client.ip}>CLIENT {client.ip} {client.delay ? client.delay + "ms" : "—"}</span>)}
                </> : <>
                  <span>SOURCE {hud.source ?? "—"}</span><span>DEST {hud.destination ?? "—"}</span>
                  <span>DELAY {hud.pairDelay ? hud.pairDelay + "ms" : "—"}</span>
                </>}
                <span>{persistence?.toUpperCase() ?? "CONNECTING"}</span>
              </div>
            </details>
          </section>
          <section className="pointer-events-auto hidden w-[min(390px,100%)] rounded-sm border bg-sidebar/90 p-3 font-mono text-xs shadow-none backdrop-blur-sm sm:block" aria-label="Replay HUD">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm tracking-widest">REPLAY</strong>
              <Badge variant="outline" className="rounded-sm">{persistence?.toUpperCase() ?? "CONNECTING"}</Badge>
            </div>
            <div className="mt-2 border-t pt-2">
              <div className="text-muted-foreground">CAPTURE TIME</div>
              <time className="block text-base font-semibold tabular-nums sm:text-lg">{captureClock} {firstLoaded ? "JST" : ""}</time>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-2">
              <div className="col-span-2 flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">{hud.stageId ? "STAGE" : "SESSION STAGE"}</span>
                <strong className="min-w-0 truncate text-right">{mapStage ?? "—"}</strong>
              </div>
              {hud.stageName && <div className="col-span-2 truncate text-muted-foreground">{hud.stageName}</div>}
              <div><span className="text-muted-foreground">DIFFICULTY</span> <strong>{hud.difficulty ?? "—"}</strong></div>
              <div><span className="text-muted-foreground">QUOTA</span> <strong>{hud.quota ?? "—"}</strong></div>
              <div><span className="text-muted-foreground">SEQUENCE</span> <strong>{hud.sequence ?? "—"}</strong></div>
              <div><span className="text-muted-foreground">JOB</span> <strong>{hud.jobType ?? "—"}</strong></div>
              <div><span className="text-muted-foreground">WAVE</span> <strong>{hud.wave ?? "—"}</strong></div>
              <div><span className="text-muted-foreground">TIDE</span> <strong>{hud.tide ?? "—"}</strong></div>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 border-t pt-2 text-muted-foreground">
              <span>ENEMY SPAWN <strong className="text-foreground">{hud.enemySpawnCount}</strong></span>
              <span>ITEM SPAWN <strong className="text-foreground">{hud.itemSpawnCount}</strong></span>
              <span>KEY <strong className="text-foreground">{keyStatus}</strong></span>
            </div>
            {latestActiveSpawn && <div className="mt-1 truncate border-t pt-1 text-foreground">
              {latestActiveSpawn.kind === "enemy" ? "ENEMY SPAWN" : "ITEM SPAWN"} · {latestActiveSpawn.actor}
            </div>}
            <div className="mt-2 border-t pt-2 text-muted-foreground">
              {hud.host ? <>
                <div className="flex justify-between gap-2"><span>SERVER</span><span className="text-foreground">{hud.host}</span></div>
                {hud.clients.map((client) => <div key={client.ip} className="flex justify-between gap-2"><span>CLIENT</span><span className="text-foreground">{client.ip} · {client.delay ? client.delay + "ms" : "—"}</span></div>)}
              </> : <>
                <div className="flex justify-between gap-2"><span>SOURCE</span><span className="text-foreground">{hud.source ?? "—"}</span></div>
                <div className="flex justify-between gap-2"><span>DEST</span><span className="text-foreground">{hud.destination ?? "—"}</span></div>
                <div className="flex justify-between gap-2"><span>DELAY</span><span className="text-foreground">{hud.pairDelay ? hud.pairDelay + "ms" : "—"}</span></div>
              </>}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t pt-2">
              <Select value={selectedSessionId ?? undefined} onValueChange={onSelectSession} disabled={sessions.length === 0}>
                <SelectTrigger className="h-8 min-w-0 flex-1 rounded-sm font-mono text-xs" aria-label="Replay session">
                  <SelectValue placeholder="SELECT SESSION" />
                </SelectTrigger>
                <SelectContent>{sessions.map((session) => <SelectItem key={session.session_id} value={session.session_id}>
                  {shortSessionId(session.session_id)} · {session.events}
                </SelectItem>)}</SelectContent>
              </Select>
              <span className="shrink-0 text-muted-foreground">{selectedEvents.length} / {replayCount}</span>
            </div>
          </section>

          <section className="pointer-events-auto w-full rounded-sm border bg-sidebar/90 p-3 font-mono text-xs shadow-none backdrop-blur-sm" aria-label="Replay transport">
            {error && <div role="alert" className="mb-2 flex items-center justify-between gap-2 border-b pb-2 text-destructive">
              <span>ERROR · {error}</span>
              {onRetry && <Button variant="outline" className="rounded-sm" onClick={onRetry}>Retry</Button>}
            </div>}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <Button variant="outline" className="rounded-sm" aria-label={playing ? "Pause replay" : "Play replay"}
                disabled={loading || error !== null || selectedEvents.length < 2 || durationMs <= 0} onClick={() => onPlayingChange(!playing)}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button variant="outline" className="rounded-sm" aria-label="Restart replay"
                disabled={loading || selectedEvents.length === 0} onClick={onRestart}>
                <RotateCcw className="size-4" />
                Restart
              </Button>
              <div className="min-w-[160px] flex-1">
                <Slider aria-label="Replay time" className="w-full" value={[elapsedMs >= durationMs ? Math.ceil(durationMs) : Math.max(0, Math.round(elapsedMs))]}
                  max={Math.max(1, Math.ceil(durationMs))} step={1} disabled={loading || error !== null || selectedEvents.length < 2 || durationMs <= 0}
                  onValueChange={(values) => onElapsedChange(Math.min(durationMs, values[0] ?? 0))} />
                <div className="mt-1 text-right tabular-nums text-muted-foreground">{formatElapsed(elapsedMs)} / {formatElapsed(durationMs)}</div>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-muted-foreground">
              <span>{currentEvent ? "#" + currentEvent.record : "—"} / {lastLoaded ? "#" + lastLoaded.record : "—"}</span>
              <span>{loading ? "LOADING " + selectedEvents.length + " / " + replayCount : error ? "LOAD INCOMPLETE" : playing ? "PLAYING" : elapsedMs >= durationMs && selectedEvents.length > 0 ? "SESSION END" : "PAUSED"}</span>
              {firstLoaded && lastLoaded && <span>RECORDS #{firstLoaded.record}–#{lastLoaded.record}</span>}
            </div>
            <details className="mt-2 border-t pt-2" onToggle={(event) => {
              if (!event.currentTarget.open || !timelineRef.current) return
              const viewportHeight = timelineRef.current.clientHeight || timelineViewportHeight
              timelineRef.current.scrollTop = Math.max(0, currentIndex * timelineRowHeight - viewportHeight / 2)
              setTimelineScrollTop(timelineRef.current.scrollTop)
            }}>
              <summary className="cursor-pointer select-none text-muted-foreground">EVENTS · {selectedEvents.length}</summary>
              <div className="mt-2 grid max-h-[min(42vh,400px)] gap-3 overflow-hidden border-t pt-2 lg:grid-cols-[minmax(220px,.65fr)_minmax(0,1fr)]">
                <div ref={timelineRef} className="h-60 overflow-y-auto border-r lg:h-80" aria-label="Recorded event timeline"
                  onScroll={(event) => setTimelineScrollTop(event.currentTarget.scrollTop)}>
                  <div className="relative" style={{ height: selectedEvents.length * timelineRowHeight }}>
                    {timeline.map((event, offset) => {
                      const index = visibleStart + offset
                      const decodedRow = event.rows.at(-1)
                      return <button key={event.session_id + ":" + event.record} type="button" aria-current={index === currentIndex ? "true" : undefined}
                        style={{ top: index * timelineRowHeight, height: timelineRowHeight }}
                        className={"absolute left-0 flex w-full items-center gap-2 border-b px-1 text-left font-mono text-xs hover:bg-muted/30 " + (index === currentIndex ? "bg-muted/30" : "")}
                        onClick={() => onPositionChange(index)}>
                        <span className="w-14 shrink-0 text-muted-foreground">#{event.record}</span>
                        <span className="min-w-0 flex-1 truncate">{decodedRow?.kind ?? "UDP"}</span>
                        <span className="truncate text-muted-foreground">{decodedRow?.status ?? "RAW"}</span>
                      </button>
                    })}
                  </div>
                </div>
                <div className="min-w-0 max-h-60 space-y-2 overflow-y-auto lg:max-h-80">
                  {currentEvent && <>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">CAPTURED</span><span className="text-right">{captureTime(currentEvent.timestamp_ns)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">SOURCE</span><span className="break-all text-right">{currentEvent.packet.source_ip}:{currentEvent.packet.source_port}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">DEST</span><span className="break-all text-right">{currentEvent.packet.destination_ip}:{currentEvent.packet.destination_port}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">PAYLOAD</span><span>{currentEvent.packet.payload_hex.length / 2} B</span></div>
                    <div className="border-t pt-1">{currentEvent.rows.map((row, index) => <div key={index} className="flex justify-between gap-3 py-1"><span>{row.kind}</span><span className="text-muted-foreground">{row.status}</span></div>)}</div>
                    <div className="border-t pt-1">{currentEvent.rows.flatMap((row) => row.fields).slice(0, 24).map((field, index) =>
                      <div key={index} className="flex justify-between gap-3 py-1"><span className="text-muted-foreground">{field.name}</span><span className="break-all text-right">{field.value}</span></div>)}</div>
                  </>}
                </div>
              </div>
            </details>
          </section>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Session replay</h3>
        </div>
        <Badge variant="outline" className="rounded-sm">DEMO</Badge>
      </div>
      <FlatCard title="Demo recording · #A82F" meta="MOCK RECORDING">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" className="rounded-sm" aria-label={playing ? "Pause replay" : "Play replay"} onClick={() => onPlayingChange(!playing)}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <span className="w-13 font-mono text-xs">{replayTime}</span>
          <Slider aria-label="Replay position" className="flex-1" value={[position]} max={100} step={1} onValueChange={(values) => onPositionChange(values[0] ?? 0)} />
          <span className="font-mono text-xs text-muted-foreground">02:00</span>
        </div>
        <div className="mt-5 grid grid-cols-3 divide-x border-t pt-4">
          <div className="pr-3"><div className="text-xs text-muted-foreground">WAVE</div><div className="mt-1 font-mono text-xl font-semibold">{position < 33 ? "01" : position < 66 ? "02" : "03"}</div></div>
          <div className="px-3"><div className="text-xs text-muted-foreground">CLIENT RTT</div><div className="mt-1 font-mono text-xl font-semibold">{(31 + position * .18).toFixed(1)} ms</div></div>
          <div className="pl-3"><div className="text-xs text-muted-foreground">EVENTS</div><div className="mt-1 font-mono text-xl font-semibold">{Math.floor(position * 4.8)}</div></div>
        </div>
      </FlatCard>
    </div>
  )
}
