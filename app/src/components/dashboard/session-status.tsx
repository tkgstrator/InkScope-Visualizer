import { Server, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { clientIp, gameKey, piaKey, serverIp } from "@/demo-data"
import { emptySessionObservation } from "@/lib/session-observation"
import type { SessionObservation } from "@/lib/session-observation"

type SessionStatusProps = {
  serverRtt: string
  clientRtt: string
  wave: number
  quota: number
  source?: "demo" | "live"
  connection?: "idle" | "connecting" | "connected" | "disconnected"
  observation?: SessionObservation
  localGameKey?: string | null
  controlKeyState?: "absent" | "pending" | "applied" | null
  controlKeyLocked?: boolean
}

export function SessionStatus({ serverRtt, clientRtt, wave, quota, source = "demo", connection = "idle", observation, localGameKey = null, controlKeyState = null, controlKeyLocked = false }: SessionStatusProps) {
  if (source === "live") {
    const observed = observation ?? emptySessionObservation()
    const peers = observed
    const configured = controlKeyState === "applied" || controlKeyState === "pending"
    const visibleGameKey = controlKeyLocked && configured ? "********************************" : localGameKey ?? (configured ? "CONFIGURED" : "—")
    const keyBadge = controlKeyLocked && configured ? "LOCKED" : localGameKey ? "LOCAL" : configured ? "CONFIGURED" : "—"
    return (
      <section className="grid min-h-0 content-start gap-2 overflow-y-auto border-r bg-background p-3 max-xl:grid-cols-2 max-xl:overflow-visible max-xl:border-b max-xl:border-r-0 max-sm:grid-cols-1" aria-label="Session status">
        <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observed peers · DELAY <Badge variant="outline" className="rounded-sm text-xs">{connection.toUpperCase()}</Badge></div>
          {peers.host === null ? <>
            <div className="flex items-center gap-2 font-mono text-xs"><Server className="size-3.5 text-[#63acff]" /><span className="w-12 text-muted-foreground">SOURCE</span><span className="min-w-0 flex-1 truncate">{peers.source ?? "—"}</span></div>
            <div className="flex items-center gap-2 font-mono text-xs"><Users className="size-3.5 text-[#6af6cd]" /><span className="w-12 text-muted-foreground">DEST</span><span className="min-w-0 flex-1 truncate">{peers.destination ?? "—"}</span></div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">DELAY {peers.pairDelay === null ? "—" : `${peers.pairDelay} ms`}</div>
          </> : <>
            <div className="flex items-center gap-2 font-mono text-xs"><Server className="size-3.5 text-[#63acff]" /><span className="w-12 text-muted-foreground">SERVER</span><span className="min-w-0 flex-1 truncate">{peers.host}</span></div>
            {peers.clients.length === 0 && <div className="flex items-center gap-2 font-mono text-xs"><Users className="size-3.5 text-[#6af6cd]" /><span className="w-12 text-muted-foreground">CLIENT</span><span>—</span></div>}
            {peers.clients.map((client) => <div key={client.ip} className="flex items-center gap-2 font-mono text-xs"><Users className="size-3.5 text-[#6af6cd]" /><span className="w-12 text-muted-foreground">CLIENT</span><span className="min-w-0 flex-1 truncate">{client.ip}</span><b>{client.delay === null ? "—" : `${client.delay} ms`}</b></div>)}
          </>}
        </Card>
        <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">Keys <Badge variant="outline" className="rounded-sm text-xs">{keyBadge}</Badge></div>
          <div className="flex gap-2 font-mono text-xs"><span className="w-12 shrink-0 text-muted-foreground">Game</span><code className={`min-w-0 ${controlKeyLocked ? "truncate" : "break-all"}`}>{visibleGameKey}</code></div>
          <div className="flex gap-2 font-mono text-xs"><span className="w-12 text-muted-foreground">Pia</span><code>—</code></div>
        </Card>
        <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">PrivateSetting · observed</div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">StageId</span><b className="truncate">{observed.stageId || "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Difficulty</span><b>{observed.difficulty ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">JobType</span><b>{observed.jobType ?? "—"}</b></div>
        </Card>
        <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gameplay · observed fields</div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Quota</span><b>{observed.quota ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Sequence</span><b>{observed.sequence ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">WAVE</span><b>{observed.wave ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Tide</span><b>{observed.tide ?? "—"}</b></div>
        </Card>
      </section>
    )
  }
  return (
    <section className="grid min-h-0 content-start gap-2 overflow-y-auto border-r bg-background p-3 max-xl:grid-cols-2 max-xl:overflow-visible max-xl:border-b max-xl:border-r-0 max-sm:grid-cols-1" aria-label="Session status">
      <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Peers · simulated RTT</div>
        <div className="flex items-center gap-2 font-mono text-xs"><Server className="size-3.5 text-[#63acff]" /><span className="w-12 text-muted-foreground">SERVER</span><span className="min-w-0 flex-1 truncate">{serverIp}</span><b>{serverRtt}ms</b></div>
        <div className="flex items-center gap-2 font-mono text-xs"><Users className="size-3.5 text-[#6af6cd]" /><span className="w-12 text-muted-foreground">CLIENT</span><span className="min-w-0 flex-1 truncate">{clientIp}</span><b>{clientRtt}ms</b></div>
      </Card>
      <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
        <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">Keys <Badge variant="outline" className="rounded-sm text-xs">DEMO HEX</Badge></div>
        <div className="flex gap-2 font-mono text-xs"><span className="w-12 text-muted-foreground">Game</span><code className="min-w-0 break-all">{gameKey}</code></div>
        <div className="flex gap-2 font-mono text-xs"><span className="w-12 text-muted-foreground">Pia</span><code className="min-w-0 break-all">{piaKey}</code></div>
      </Card>
      <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">PrivateSetting · P11</div>
        <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">StageId</span><b>Cop_Shakedent</b></div>
        <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Difficulty</span><b>1665</b></div>
        <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">JobType</span><b>1</b></div>
      </Card>
      <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gameplay · demo</div>
        <div className="flex items-center justify-between font-mono text-xs"><span>WAVE <b className="text-lg">0{wave}/03</b></span><span>QUOTA <b>{quota}</b></span></div>
        <div className="grid grid-cols-3 gap-1">{[1, 2, 3].map((step) => <div key={step} className={`h-1 ${step <= wave ? "bg-[#ff5033]" : "bg-muted"}`} />)}</div>
        <div className="font-mono text-xs text-muted-foreground">Sequence 1</div>
      </Card>
    </section>
  )
}
