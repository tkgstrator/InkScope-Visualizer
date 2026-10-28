import { useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { clientIp, serverIp } from "@/demo-data"
import type { OverlayFeedState } from "@/lib/live-feed"
import { emptySessionObservation, type SessionObservation } from "@/lib/session-observation"
import type { PacketEnvelope } from "../../../../api/wire"

export function Overlay({ serverRtt, clientRtt, wave, quota, source = "demo", liveFeed, recordedObservation, recordedEvent }: {
  serverRtt: string
  clientRtt: string
  wave: number
  quota: number
  source?: "demo" | "live" | "recorded"
  liveFeed?: OverlayFeedState
  recordedObservation?: SessionObservation
  recordedEvent?: PacketEnvelope
}) {
  const recorded = recordedObservation ?? emptySessionObservation()
  const recordedRow = recordedEvent?.rows.find((row) => row.status === "authenticated" || row.status === "proof_verified") ?? recordedEvent?.rows[0]
  useEffect(() => {
    document.documentElement.classList.add("obs-overlay")
    return () => document.documentElement.classList.remove("obs-overlay")
  }, [])
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent p-8 text-white">
      <div className="absolute bottom-8 left-8 flex flex-col gap-2">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold tracking-[.2em] text-white/70"><span className="size-2 rounded-full bg-emerald-400" /> INKSCOPE <Badge variant="outline" className="rounded-sm border-white/30 text-xs text-white">{source.toUpperCase()}</Badge></div>
        <Card className="w-[360px] gap-0 rounded-md border border-white/20 bg-neutral-950/90 py-0 text-white shadow-none ring-0">
          <CardContent className="space-y-2 p-4 font-mono text-sm">
            {source === "live" ? <>
              <div className="flex justify-between"><span className="text-white/60">STREAM</span><span>{liveFeed?.connection.toUpperCase() ?? "WAITING"}</span></div>
              <Separator className="bg-white/20" />
              <div className="flex justify-between gap-3"><span className="text-white/60">LATEST</span><span className="truncate text-right">{liveFeed?.latest?.kind ?? "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-white/60">STATUS</span><span className="truncate text-right">{liveFeed?.latest?.status ?? "—"}</span></div>
            </> : source === "recorded" ? <>
              {recorded.host ? <>
                <div className="flex justify-between gap-3"><span className="text-white/60">SERVER</span><span className="truncate text-right">{recorded.host}</span></div>
                {recorded.clients.length === 0 && <div className="flex justify-between gap-3"><span className="text-white/60">CLIENT</span><span>—</span></div>}
                {recorded.clients.map((client) => <div key={client.ip} className="flex justify-between gap-3"><span className="text-white/60">CLIENT</span><span className="truncate text-right">{client.ip} · {client.delay === null ? "—" : `${client.delay} ms`}</span></div>)}
              </> : <>
                <div className="flex justify-between gap-3"><span className="text-white/60">SOURCE</span><span className="truncate text-right">{recorded.source ?? "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-white/60">DEST</span><span className="truncate text-right">{recorded.destination ?? "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-white/60">DELAY</span><span>{recorded.pairDelay === null ? "—" : `${recorded.pairDelay} ms`}</span></div>
              </>}
              <Separator className="bg-white/20" />
              <div className="flex justify-between gap-3"><span className="text-white/60">STAGE</span><span className="truncate text-right">{recorded.stageId || "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-white/60">DIFFICULTY</span><span>{recorded.difficulty ?? "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-white/60">QUOTA</span><span>{recorded.quota ?? "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-white/60">SEQUENCE</span><span>{recorded.sequence ?? "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-white/60">LATEST</span><span className="truncate text-right">{recordedRow?.kind ?? "—"}</span></div>
            </> : <>
              <div className="flex justify-between"><span className="text-white/60">SERVER</span><span>{serverIp} <b>{serverRtt}ms</b></span></div>
              <div className="flex justify-between"><span className="text-white/60">CLIENT</span><span>{clientIp} <b>{clientRtt}ms</b></span></div>
              <Separator className="bg-white/20" />
              <div className="flex justify-between"><span>Cop_Shakedent</span><span>Difficulty 1665</span></div>
              <div className="flex justify-between text-white/70"><span>WAVE 0{wave} / 03</span><span>Quota {quota}</span></div>
            </>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
