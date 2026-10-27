import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FlatCard } from "@/components/dashboard/flat-card"

export type ControlStatus = {
  version: 1
  state: "unconfigured" | "reachable" | "unreachable" | "untrusted"
  target: { host: string; port: number } | null
  capture?: "running" | string
  key_state?: "absent" | "pending" | "applied"
  key_locked?: boolean
  key_source?: "none" | "control" | "cli" | "file" | "elf" | "random_table"
  key_epoch?: number
  publisher?: { enabled: boolean; connection: string }
}

const defaultHost = "127.0.0.1"
const defaultPort = "10254"
const maskedKey = "********************************"

function statusLabel(status: ControlStatus | null, loading: boolean): string {
  if (loading && !status) return "CHECKING"
  return status?.state.toUpperCase() ?? "UNREACHABLE"
}

export function SettingsView({ onGameKeyConnected, onControlConnected, onDisconnected, onStatus }: {
  onGameKeyConnected: (key: string) => void
  onControlConnected: () => void
  onDisconnected: () => void
  onStatus: (keyState: NonNullable<ControlStatus["key_state"]> | null, keyLocked: boolean) => void
}) {
  const [host, setHost] = useState(defaultHost)
  const [port, setPort] = useState(defaultPort)
  const [gameKey, setGameKey] = useState("")
  const [status, setStatus] = useState<ControlStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)
  const statusSequence = useRef(0)
  const mounted = useRef(false)

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++statusSequence.current
    try {
      const response = await fetch("/api/control/status", { signal, cache: "no-store" })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const next = await response.json() as ControlStatus
      if (next.version !== 1 || !["unconfigured", "reachable", "unreachable", "untrusted"].includes(next.state)) throw new Error("INVALID STATUS")
      if (signal?.aborted || !mounted.current || sequence !== statusSequence.current) return
      setStatus(next)
      const locked = next.state === "reachable" && next.key_locked === true
      if (locked) setGameKey("")
      onStatus(next.state === "reachable" ? next.key_state ?? null : null, locked)
      if (!initialized.current && next.target) {
        setHost(next.target.host)
        setPort(String(next.target.port))
      }
      initialized.current = true
    } catch {
      if (!signal?.aborted && mounted.current && sequence === statusSequence.current) {
        setStatus(null)
        onStatus(null, false)
      }
    } finally {
      if (!signal?.aborted && mounted.current && sequence === statusSequence.current) setLoading(false)
    }
  }, [onStatus])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void refreshStatus(controller.signal)
    const timer = window.setInterval(() => void refreshStatus(controller.signal), 3_000)
    return () => { mounted.current = false; statusSequence.current++; controller.abort(); window.clearInterval(timer) }
  }, [refreshStatus])

  const validPort = /^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535
  const validKey = /^[0-9a-fA-F]{32}$/.test(gameKey)
  const validHost = host === defaultHost
  const keyLocked = status?.state === "reachable" && status.key_locked === true

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validHost || !validPort || gameKey.length > 0 && !validKey || busy || keyLocked) return
    const key = gameKey
    statusSequence.current++
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/control/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(key ? { host, port: Number(port), game_key: key } : { host, port: Number(port) }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json() as ControlStatus
      setGameKey("")
      await refreshStatus()
      if (key && result.key_locked !== true) onGameKeyConnected(key)
      else onControlConnected()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CONNECT FAILED")
    } finally {
      setBusy(false)
    }
  }

  async function checkTarget() {
    if (!validHost || !validPort || busy) return
    statusSequence.current++
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/control/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port: Number(port) }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await refreshStatus()
      onControlConnected()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CHECK FAILED")
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (busy || keyLocked) return
    statusSequence.current++
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/control/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await refreshStatus()
      onDisconnected()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DISCONNECT FAILED")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">InkScope settings</h3>
        <Badge variant="outline" className="rounded-sm font-mono text-xs">{statusLabel(status, loading)}</Badge>
      </div>

      <FlatCard title="Connection" meta="LOCAL CONTROL" className="max-w-2xl">
        <form className="space-y-4" onSubmit={(event) => void connect(event)}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <label className="block min-w-0 space-y-1.5 text-xs font-medium" htmlFor="inkscope-host">
              <span>InkScope IP</span>
              <Input id="inkscope-host" className="h-8 rounded-sm font-mono text-xs" value={host} onChange={(event) => setHost(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!validHost} />
            </label>
            <label className="block space-y-1.5 text-xs font-medium" htmlFor="inkscope-port">
              <span>Port</span>
              <Input id="inkscope-port" className="h-8 rounded-sm font-mono text-xs" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" autoComplete="off" aria-invalid={!validPort} />
            </label>
          </div>
          <label className="block space-y-1.5 text-xs font-medium" htmlFor="inkscope-game-key">
            <span>GameKey</span>
            <Input id="inkscope-game-key" type={keyLocked ? "text" : "password"} className="h-8 rounded-sm font-mono text-xs" value={keyLocked ? maskedKey : gameKey} onChange={(event) => setGameKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={32} readOnly={keyLocked} disabled={keyLocked} />
          </label>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button className="h-8 rounded-sm font-mono text-xs" type="submit" disabled={!validHost || !validPort || gameKey.length > 0 && !validKey || busy || keyLocked}>Connect</Button>
            {keyLocked && <Button className="h-8 rounded-sm font-mono text-xs" type="button" variant="outline" disabled={!validHost || !validPort || busy} onClick={() => void checkTarget()}>Check target</Button>}
            <Button className="h-8 rounded-sm font-mono text-xs" type="button" variant="outline" disabled={busy || status?.state !== "reachable" || keyLocked} onClick={() => void disconnect()}>Disconnect</Button>
            {error && <span role="alert" className="font-mono text-xs text-destructive">{error}</span>}
          </div>
        </form>
      </FlatCard>

      <div className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Control", statusLabel(status, loading)],
          ["Capture", status?.capture?.toUpperCase() ?? "—"],
          ["Key", status?.key_state?.toUpperCase() ?? "—"],
          ["Publisher", status?.publisher?.connection.toUpperCase() ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="border-b py-3">
            <div className="font-mono text-xs uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 break-words font-mono text-sm font-semibold" aria-label={`${label} status`}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
