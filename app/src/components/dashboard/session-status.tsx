import { Server, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { clientIp, gameKey, piaKey, serverIp } from "@/demo-data"
import type { PacketEnvelope } from "../../../../api/wire"

type SessionStatusProps = {
  serverRtt: string
  clientRtt: string
  wave: number
  quota: number
  source?: "demo" | "live"
  connection?: "idle" | "connecting" | "connected" | "disconnected"
  liveEvents?: PacketEnvelope[]
  localGameKey?: string | null
  controlKeyState?: "absent" | "pending" | "applied" | null
  controlKeyLocked?: boolean
}

function latestField(events: PacketEnvelope[], name: string, kind?: string): string | null {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
    for (const row of events[eventIndex]!.rows) {
      if (row.status !== "authenticated" || kind !== undefined && row.kind !== kind) continue
      const field = row.fields.find((item) => item.name === name)
      if (field) return field.value
    }
  }
  return null
}

function verifiedHost(event: PacketEnvelope): string | null {
  const host = event.rows
    .filter((row) => row.kind === "BrowseReply" && row.status === "proof_verified")
    .flatMap((row) => row.fields)
    .find((field) => field.name === "HostIPv4")?.value
  return host === event.packet.source_ip ? host : null
}

function isUnicast(ip: string): boolean {
  const octets = ip.split(".").map(Number)
  return octets.length === 4 && octets[0] !== 0 && octets[0]! < 224 && octets[3] !== 255
}

function delayFor(event: PacketEnvelope): string | null {
  for (const row of event.rows) {
    if (row.kind !== "RTTProtocol" || row.status !== "authenticated" || row.fields.find((field) => field.name === "Type")?.value !== "1") continue
    const delay = row.fields.find((field) => field.name === "CaptureResponseDelayMs")?.value
    if (delay && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(delay) && Number.isFinite(Number(delay)) && Number(delay) > 0) return delay
  }
  return null
}

function pairMatches(event: PacketEnvelope, first: string, second: string): boolean {
  return event.packet.source_ip === first && event.packet.destination_ip === second ||
    event.packet.source_ip === second && event.packet.destination_ip === first
}

function observedPeers(events: PacketEnvelope[]): {
  host: string | null
  clients: Array<{ ip: string; delay: string | null }>
  source: string | null
  destination: string | null
  pairDelay: string | null
} {
  const latest = events.at(-1)
  if (!latest) return { host: null, clients: [], source: null, destination: null, pairDelay: null }

  let host: string | null = null
  let firstProof = -1
  for (let index = events.length - 1; index >= 0; index--) {
    const candidate = verifiedHost(events[index]!)
    if (candidate === null) continue
    if (host === null) host = candidate
    if (candidate !== host) break
    firstProof = index
  }

  if (host !== null) {
    const clients = new Map<string, string | null>()
    for (const event of events.slice(firstProof)) {
      if (verifiedHost(event) !== host && !event.rows.some((row) => row.status === "authenticated")) continue
      const peer: string | null = event.packet.source_ip === host ? event.packet.destination_ip :
        event.packet.destination_ip === host ? event.packet.source_ip : null
      if (peer === null || peer === host || !isUnicast(peer)) continue
      if (!clients.has(peer)) clients.set(peer, null)
      const delay = delayFor(event)
      if (delay !== null) clients.set(peer, delay)
    }
    return {
      host,
      clients: Array.from(clients, ([ip, delay]) => ({ ip, delay })).sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })),
      source: null,
      destination: null,
      pairDelay: null,
    }
  }

  const source = latest.packet.source_ip
  const destination = latest.packet.destination_ip
  let pairDelay: string | null = null
  for (const event of events) {
    if (!pairMatches(event, source, destination)) continue
    pairDelay = delayFor(event) ?? pairDelay
  }
  return { host: null, clients: [], source, destination, pairDelay }
}

export function SessionStatus({ serverRtt, clientRtt, wave, quota, source = "demo", connection = "idle", liveEvents = [], localGameKey = null, controlKeyState = null, controlKeyLocked = false }: SessionStatusProps) {
  if (source === "live") {
    const latest = liveEvents.at(-1)
    const sessionEvents = latest ? liveEvents.filter((event) => event.session_id === latest.session_id) : []
    const stage = latestField(sessionEvents, "StageId", "PrivateSetting") ?? latestField(sessionEvents, "StageResource")
    const difficulty = latestField(sessionEvents, "Difficulty", "PrivateSetting") ?? latestField(sessionEvents, "Difficulty")
    const jobType = latestField(sessionEvents, "JobType")
    const quotaField = latestField(sessionEvents, "Quota")
    const sequence = latestField(sessionEvents, "Sequence")
    const peers = observedPeers(sessionEvents)
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
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">StageId</span><b className="truncate">{stage || "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Difficulty</span><b>{difficulty ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">JobType</span><b>{jobType ?? "—"}</b></div>
        </Card>
        <Card className="gap-1 rounded-sm p-3 shadow-none ring-0">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gameplay · observed fields</div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Quota</span><b>{quotaField ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Sequence</span><b>{sequence ?? "—"}</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">WAVE</span><b>—</b></div>
          <div className="flex justify-between gap-2 font-mono text-xs"><span className="text-muted-foreground">Tide</span><b>—</b></div>
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
