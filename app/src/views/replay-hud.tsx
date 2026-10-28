import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ReplayGameSnapshot } from "@/lib/replay-game-state"
import type { ReplaySession } from "./replay-view"

type ReplayHudProps = {
  hud: ReplayGameSnapshot
  captureClock: string
  hasCapture: boolean
  mapStage: string | null
  remainingSeconds: number | null
  keyStatus: string
  sessions: ReplaySession[]
  selectedSessionId: string | null
  selectedEventsCount: number
  replayCount: string
  persistence: "memory" | "postgres" | null
  onSelectSession: (sessionId: string) => void
}

export function ReplayHud({
  hud, captureClock, hasCapture, mapStage, remainingSeconds, keyStatus, sessions,
  selectedSessionId, selectedEventsCount, replayCount, persistence, onSelectSession,
}: ReplayHudProps) {
  const tiles = [
    { label: "ENEMY SPAWN", value: hud.enemySpawnCount, tone: "bg-[#bb4934]/95" },
    { label: "ITEM SPAWN", value: hud.itemSpawnCount, tone: "bg-[#995036]/95" },
    { label: "TIDE", value: hud.tide ?? "—", tone: "bg-[#75503b]/95" },
    { label: "KEY", value: keyStatus, tone: "bg-[#4f5541]/95" },
  ] as const

  return (
    <section className="replay-hud-font pointer-events-auto w-[min(390px,100%)] text-[#f3e9e5] drop-shadow-[0_2px_5px_rgba(0,0,0,.75)]" aria-label="Replay HUD">
      <div className="flex items-baseline gap-5 px-1 text-[13px] leading-5 tracking-wide">
        <span>WAVE <strong className="text-base text-white">{hud.wave ?? "—"}</strong></span>
        <span>QUOTA <strong className="text-base text-[#f3d453]">{hud.quota ?? "—"}</strong></span>
      </div>
      <div className="mt-0.5 flex h-[68px] items-center justify-between bg-[#151719]/95 px-3">
        <div className="flex items-baseline gap-3">
          <span className="self-center text-[11px] tracking-widest text-[#d4d5d0]">TIME</span>
          {remainingSeconds !== null && hud.remainingSecondsEstimated && <span className="text-xl text-[#d4d5d0]" aria-hidden="true">≈</span>}
          <strong className="replay-hud-display text-[56px] leading-none tabular-nums text-white" aria-label={remainingSeconds === null ? "Remaining time unavailable" : `${hud.remainingSecondsEstimated ? "Estimated " : ""}remaining time ${remainingSeconds} seconds`}>
            {remainingSeconds ?? "—"}
          </strong>
        </div>
        <span className="text-xs tracking-widest text-[#d4d5d0]">SEC</span>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        {tiles.map((tile) => <div key={tile.label} className={`flex h-[52px] min-w-0 flex-col justify-between px-1.5 py-1 ${tile.tone}`} aria-label={`${tile.label} ${tile.value}`}>
          <span className="truncate text-[9px] leading-3 tracking-tight">{tile.label} </span>
          <strong className={`${String(tile.value).length > 8 ? "text-[10px]" : String(tile.value).length > 5 ? "text-[13px]" : "text-[17px]"} whitespace-nowrap leading-5 tabular-nums`}>{tile.value}</strong>
        </div>)}
      </div>
      <div className="mt-1 bg-[#151719]/90 px-2 py-1.5 text-[11px] backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <strong className="min-w-0 truncate text-[13px]">{mapStage ?? "STAGE —"}</strong>
          <span className="shrink-0">DIFFICULTY {hud.difficulty ?? "—"}</span>
        </div>
        <time className="mt-0.5 block truncate tabular-nums text-[#d4d5d0]">{captureClock} {hasCapture ? "JST" : ""}</time>
        <div className="mt-1 flex items-center gap-2 border-t border-white/15 pt-1">
          <Select value={selectedSessionId ?? undefined} onValueChange={onSelectSession} disabled={sessions.length === 0}>
            <SelectTrigger className="h-7 min-w-0 flex-1 rounded-sm border-white/20 bg-transparent text-[11px]" aria-label="Replay session">
              <SelectValue placeholder="SELECT SESSION" />
            </SelectTrigger>
            <SelectContent>{sessions.map((session) => <SelectItem key={session.session_id} value={session.session_id}>
              {session.session_id.slice(0, 8)} · {session.events}
            </SelectItem>)}</SelectContent>
          </Select>
          <span className="shrink-0 tabular-nums text-[#d4d5d0]">{selectedEventsCount} / {replayCount}</span>
        </div>
        <details className="mt-1 border-t border-white/15 pt-1 text-[#d4d5d0]">
          <summary className="cursor-pointer select-none">DETAILS</summary>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[#f3e9e5]">
            {hud.stageName && <span className="col-span-2 truncate">{hud.stageName}</span>}
            <span>SEQUENCE {hud.sequence ?? "—"}</span><span>JOB {hud.jobType ?? "—"}</span>
            {hud.host ? <>
              <span className="col-span-2 truncate">SERVER {hud.host}</span>
              {hud.clients.map((client) => <span className="col-span-2 truncate" key={client.ip}>CLIENT {client.ip} {client.delay ? `${client.delay}ms` : "—"}</span>)}
            </> : <>
              <span className="truncate">SOURCE {hud.source ?? "—"}</span><span className="truncate">DEST {hud.destination ?? "—"}</span>
              <span>DELAY {hud.pairDelay ? `${hud.pairDelay}ms` : "—"}</span>
            </>}
            <span>{persistence?.toUpperCase() ?? "CONNECTING"}</span>
          </div>
        </details>
      </div>
    </section>
  )
}
