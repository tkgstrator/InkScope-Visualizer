import { Pause, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { FlatCard } from "@/components/dashboard/flat-card"
import type { PacketEnvelope } from "../../../api/wire"

export type ReplaySession = {
  session_id: string
  events: string
  first_timestamp_ns: string
  last_timestamp_ns: string
}

export type ReplayViewProps = {
  source: "demo" | "live" | "replay"
  persistence?: "memory" | "postgres" | null
  sessions: ReplaySession[]
  selectedSessionId: string | null
  selectedEvents: PacketEnvelope[]
  loading: boolean
  error: string | null
  hasMore: boolean
  hasPrevious?: boolean
  pageNumber?: number
  pageStartIndex?: number
  onSelectSession: (sessionId: string) => void
  onLoadMore: () => void
  onLoadPrevious?: () => void
  position: number
  playing: boolean
  onPositionChange: (position: number) => void
  onPlayingChange: (playing: boolean) => void
}

function captureTime(timestampNs: string): string {
  try {
    const millis = BigInt(timestampNs) / 1_000_000n
    if (millis > BigInt(Number.MAX_SAFE_INTEGER)) return timestampNs
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date(Number(millis)))
  } catch {
    return timestampNs
  }
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

function captureRange(events: readonly PacketEnvelope[]): [string, string] | null {
  if (events.length === 0) return null
  let earliest = events[0]!.timestamp_ns
  let latest = earliest
  for (const event of events.slice(1)) {
    if (BigInt(event.timestamp_ns) < BigInt(earliest)) earliest = event.timestamp_ns
    if (BigInt(event.timestamp_ns) > BigInt(latest)) latest = event.timestamp_ns
  }
  return [earliest, latest]
}

export function ReplayView({
  source, persistence = null, sessions, selectedSessionId, selectedEvents, loading, error,
  hasMore, hasPrevious = false, pageNumber = 1, pageStartIndex = 0,
  onSelectSession, onLoadMore, onLoadPrevious, position, playing, onPositionChange, onPlayingChange,
}: ReplayViewProps) {
  const replaySeconds = Math.floor(position * 1.2)
  const replayTime = `${String(Math.floor(replaySeconds / 60)).padStart(2, "0")}:${String(replaySeconds % 60).padStart(2, "0")}`
  const selectedSession = sessions.find((session) => session.session_id === selectedSessionId)
  const currentIndex = Math.min(Math.max(0, Math.floor(position)), Math.max(0, selectedEvents.length - 1))
  const currentEvent = selectedEvents[currentIndex]
  const windowStart = Math.max(0, Math.min(currentIndex - 10, selectedEvents.length - 21))
  const timeline = selectedEvents.slice(windowStart, windowStart + 21)
  const firstLoaded = selectedEvents[0]
  const lastLoaded = selectedEvents.at(-1)
  const captureBounds = captureRange(selectedEvents)
  const pageEnd = selectedEvents.length > 0 && currentIndex === selectedEvents.length - 1
  const changePage = (direction: "previous" | "next") => {
    onPlayingChange(false)
    onPositionChange(0)
    if (direction === "previous") onLoadPrevious?.()
    else onLoadMore()
  }

  if (source !== "demo") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Session replay</h3>
          </div>
          <Badge variant="outline" className="rounded-sm">{persistence?.toUpperCase() ?? "CONNECTING"}</Badge>
        </div>
        {persistence !== "postgres" ? (
          <FlatCard title="Sessions" meta="UNAVAILABLE"><span role="status" className="font-mono text-xs text-muted-foreground">{persistence === null ? "CONNECTING" : "NO DATABASE"}</span></FlatCard>
        ) : (
          <div className="grid gap-3 2xl:grid-cols-[300px_minmax(0,1fr)]">
            <FlatCard title="Sessions" meta={String(sessions.length)} className="min-w-0">
              <div className="max-h-[560px] divide-y overflow-y-auto">
                {sessions.map((session) => (
                  <button key={session.session_id} type="button" aria-pressed={session.session_id === selectedSessionId}
                    title={session.session_id} aria-label={`Session ${session.session_id}`}
                    className={`w-full px-1 py-3 text-left hover:bg-muted/30 ${session.session_id === selectedSessionId ? "bg-muted/30" : ""}`}
                    onClick={() => onSelectSession(session.session_id)}>
                    <span className="flex items-center justify-between gap-2 font-mono text-xs"><strong>{shortSessionId(session.session_id)}</strong><span className="text-muted-foreground">{session.events} events</span></span>
                    <span className="mt-1 block font-mono text-xs text-muted-foreground">{captureTime(session.first_timestamp_ns)}</span>
                  </button>
                ))}
                {sessions.length === 0 && <div className="py-3 font-mono text-xs text-muted-foreground">{loading ? "LOADING" : "NO SESSIONS"}</div>}
              </div>
            </FlatCard>
            <FlatCard title={selectedSession ? `Session ${shortSessionId(selectedSession.session_id)}` : "Timeline"}
              meta={selectedSession ? selectedEvents.length > 0 ? `${pageStartIndex + 1}–${pageStartIndex + selectedEvents.length} / ${selectedSession.events}` : `0 / ${selectedSession.events}` : "SELECT SESSION"} className="min-w-0">
              {error && <div role="alert" className="mb-3 font-mono text-xs text-destructive">ERROR · {error}</div>}
              {selectedSession && <>
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                  <span>PAGE {pageNumber}</span>
                  {firstLoaded && lastLoaded && <>
                    <span>RECORDS #{firstLoaded.record}–#{lastLoaded.record}</span>
                    {captureBounds && <span>CAPTURE RANGE {captureTime(captureBounds[0])}–{captureTime(captureBounds[1])}</span>}
                  </>}
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="icon" className="rounded-sm" aria-label={playing ? "Pause replay" : "Play replay"}
                    disabled={selectedEvents.length === 0} onClick={() => onPlayingChange(!playing)}>
                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                  <span className="w-20 shrink-0 font-mono text-xs">{currentEvent ? `#${currentEvent.record}` : "—"}</span>
                  <Slider aria-label="Replay position" className="flex-1" value={[currentIndex]}
                    max={Math.max(1, selectedEvents.length - 1)} step={1} disabled={selectedEvents.length < 2}
                    onValueChange={(values) => onPositionChange(values[0] ?? 0)} />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{selectedEvents.length === 0 ? 0 : currentIndex + 1}/{selectedEvents.length}</span>
                </div>
                <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-[minmax(180px,.6fr)_minmax(0,1fr)]">
                  <div className="max-h-[320px] divide-y overflow-y-auto" aria-label="Recorded event timeline">
                    {timeline.map((event, offset) => {
                      const index = windowStart + offset
                      const firstRow = event.rows[0]
                      return <button key={`${event.session_id}:${event.record}`} type="button" aria-current={index === currentIndex ? "true" : undefined}
                        className={`flex w-full items-center gap-2 px-1 py-2 text-left font-mono text-xs hover:bg-muted/30 ${index === currentIndex ? "bg-muted/30" : ""}`}
                        onClick={() => onPositionChange(index)}>
                        <span className="w-14 shrink-0 text-muted-foreground">#{event.record}</span>
                        <span className="min-w-0 flex-1 truncate">{firstRow?.kind ?? "UDP"}</span>
                        <span className="truncate text-muted-foreground">{firstRow?.status ?? "RAW"}</span>
                      </button>
                    })}
                    {selectedEvents.length === 0 && <div className="py-2 font-mono text-xs text-muted-foreground">{loading ? "LOADING" : "NO EVENTS"}</div>}
                  </div>
                  <div className="min-w-0 space-y-2 font-mono text-xs">
                    {currentEvent && <>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">CAPTURED</span><span className="text-right">{captureTime(currentEvent.timestamp_ns)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">NS</span><span className="break-all text-right">{currentEvent.timestamp_ns}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">SOURCE</span><span className="break-all text-right">{currentEvent.packet.source_ip}:{currentEvent.packet.source_port}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">DESTINATION</span><span className="break-all text-right">{currentEvent.packet.destination_ip}:{currentEvent.packet.destination_port}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">PAYLOAD</span><span>{currentEvent.packet.payload_hex.length / 2} B</span></div>
                      <div className="flex justify-between gap-3"><span className="text-muted-foreground">ROWS</span><span>{currentEvent.rows.length}</span></div>
                      <div className="border-t pt-2">{currentEvent.rows.map((row, index) => <div key={index} className="flex justify-between gap-3 py-1"><span>{row.kind}</span><span className="text-muted-foreground">{row.status}</span></div>)}</div>
                      <div className="max-h-40 overflow-y-auto border-t pt-2">
                        {currentEvent.rows.flatMap((row) => row.fields).slice(0, 24).map((field, index) => (
                          <div key={index} className="flex justify-between gap-3 py-1"><span className="text-muted-foreground">{field.name}</span><span className="break-all text-right">{field.value}</span></div>
                        ))}
                      </div>
                    </>}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 font-mono text-xs text-muted-foreground">
                  <span>{loading ? "LOADING" : pageEnd ? hasMore ? "PAGE END · NEXT PAGE" : "SESSION END" : `${selectedEvents.length} ON PAGE`}</span>
                  <div className="flex gap-2">
                    {hasPrevious && <Button variant="outline" className="rounded-sm" disabled={loading} onClick={() => changePage("previous")}>Previous page</Button>}
                    {hasMore && <Button variant="outline" className="rounded-sm" disabled={loading} onClick={() => changePage("next")}>Next page</Button>}
                  </div>
                </div>
              </>}
              {!selectedSession && <div className="font-mono text-xs text-muted-foreground">SELECT SESSION</div>}
            </FlatCard>
          </div>
        )}
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
