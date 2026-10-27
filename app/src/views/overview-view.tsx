export type WaveSummary = {
  wave: number
  tide?: string | null
  event?: string | null
  quota?: number | null
  state?: string | null
}

export type OverviewActivity = {
  id: string
  label: string
  detail?: string | null
  time?: string | null
}

export type OverviewViewProps = {
  source: "demo" | "live" | "replay"
  total: number | null
  authenticated: number | null
  clientRtt: number | string | null
  wave: number | null
  waves: readonly WaveSummary[]
  onWaveChange: (wave: number) => void
  serverIp?: string
  activities?: readonly OverviewActivity[]
}

import { Badge } from "@/components/ui/badge"
import { FlatCard } from "@/components/dashboard/flat-card"

export function OverviewView({ source, total, authenticated, clientRtt, wave, waves, onWaveChange, serverIp, activities }: OverviewViewProps) {
  const sourceLabel = source.toUpperCase()
  const rtt = clientRtt === null ? null : String(clientRtt)
  const activityRows = activities ?? (source === "demo" ? [
    { id: "wave", label: "WAVE 02 state updated", detail: "Sequence 1 · Quota 24", time: "NOW" },
    { id: "rtt", label: "RTT response paired", detail: `Client ↔ Server · ${rtt ?? "—"} ms`, time: "2s" },
    { id: "setting", label: "PrivateSetting received", detail: "Cop_Shakedent · Difficulty 1665", time: "12s" },
    { id: "pia", label: "Pia packet authenticated", detail: "PiaKey derived from BrowseReply", time: "18s" },
    { id: "room", label: "Room discovered", detail: `Server ${serverIp ?? "—"}`, time: "24s" },
  ] : [])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FlatCard title="Captured packets" meta={sourceLabel}>
          <div className="font-mono text-3xl font-semibold">{total ?? "—"}</div>
        </FlatCard>
        <FlatCard title="Authenticated" meta={sourceLabel}>
          <div className="font-mono text-3xl font-semibold">{authenticated ?? "—"}</div>
        </FlatCard>
        <FlatCard title="Response delay" meta={sourceLabel}>
          <div className="font-mono text-3xl font-semibold">{rtt ?? "—"}{rtt !== null && <span className="ml-1 text-sm font-normal text-muted-foreground">ms</span>}</div>
        </FlatCard>
      </div>
      <div className="grid gap-4 2xl:grid-cols-[1.1fr_.9fr]">
        <FlatCard title="WAVE overview" meta={sourceLabel}>
          <div className="divide-y">
            {waves.length === 0 && <div className="py-3 font-mono text-xs text-muted-foreground">WAVE —</div>}
            {waves.map((item) => (
              <button
                key={item.wave}
                type="button"
                aria-pressed={wave === item.wave}
                className={`flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted/30 ${wave === item.wave ? "bg-muted/30" : ""}`}
                onClick={() => onWaveChange(item.wave)}
              >
                <span className="font-mono text-lg font-semibold">{String(item.wave).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-xs">{item.tide ?? "—"}</strong>
                  <small className="text-xs text-muted-foreground">{item.event ?? "—"} · Quota {item.quota ?? "—"}</small>
                </span>
                {item.state && <Badge variant="outline" className="rounded-sm font-mono text-xs">{item.state}</Badge>}
              </button>
            ))}
          </div>
        </FlatCard>
        <FlatCard title="Session activity" meta={sourceLabel}>
          <div className="divide-y">
            {activityRows.length === 0 && <div className="py-3 font-mono text-xs text-muted-foreground">NO EVENTS</div>}
            {activityRows.map((item) => (
              <div key={item.id} className="flex gap-3 py-3 first:pt-0">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{item.label}</div>
                  {item.detail && <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>}
                </div>
                {item.time && <span className="font-mono text-xs text-muted-foreground">{item.time}</span>}
              </div>
            ))}
          </div>
        </FlatCard>
      </div>
    </div>
  )
}
