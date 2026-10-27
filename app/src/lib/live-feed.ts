import { useEffect, useState } from "react"
import type { OverlayPacket, PacketEnvelope } from "../../../api/wire"
import { emptySessionObservation, foldObservation } from "./session-observation"
import type { SessionObservation } from "./session-observation"

export type LiveGap = {
  sessionId: string
  expectedRecord: string
  actualRecord: string
}

export type LiveFeedState = {
  connection: "idle" | "connecting" | "connected" | "disconnected"
  persistence: "memory" | "postgres" | null
  events: PacketEnvelope[]
  gaps: LiveGap[]
  observation: SessionObservation
}

export function emptyLiveFeed(): LiveFeedState {
  return {
    connection: "idle", persistence: null, events: [], gaps: [],
    observation: emptySessionObservation(),
  }
}

function isPacket(value: unknown): value is PacketEnvelope {
  if (!value || typeof value !== "object") return false
  const event = value as Partial<PacketEnvelope>
  return event.version === 1 && event.type === "packet" &&
    typeof event.session_id === "string" && typeof event.record === "string" &&
    typeof event.timestamp_ns === "string" && Array.isArray(event.rows) &&
    Boolean(event.packet && typeof event.packet.payload_hex === "string")
}

export function applyLiveSnapshot(current: LiveFeedState, events: PacketEnvelope[]): LiveFeedState {
  const validEvents = events.filter((event) => /^(0|[1-9][0-9]{0,19})$/.test(event.record) && BigInt(event.record) <= 18_446_744_073_709_551_615n)
  const lastSession = validEvents.at(-1)?.session_id
  if (!lastSession) return { ...current, connection: "connected" }
  const sessionEvents = validEvents.filter((event) => event.session_id === lastSession)
  return sessionEvents
    .sort((left, right) => {
      const a = BigInt(left.record)
      const b = BigInt(right.record)
      return a < b ? -1 : a > b ? 1 : 0
    })
    .reduce(applyLivePacket, { ...current, connection: "connected" })
}

export function applyLivePacket(current: LiveFeedState, event: PacketEnvelope): LiveFeedState {
  const observation = foldObservation(current.observation, event)
  if (observation === current.observation) return current
  const sameSession = current.observation.sessionId === event.session_id
  const hostReset = sameSession && current.observation.host !== null && observation.host !== current.observation.host
  return {
    ...current,
    observation,
    events: [...(sameSession && !hostReset ? current.events : []), event].slice(-512),
  }
}

export function useLiveFeed(enabled: boolean): LiveFeedState {
  const [state, setState] = useState<LiveFeedState>(emptyLiveFeed)

  useEffect(() => {
    if (!enabled) {
      setState(emptyLiveFeed())
      return
    }

    let active = true
    let socket: WebSocket | null = null
    let retry: number | undefined
    let attempt = 0

    const connect = () => {
      if (!active) return
      setState((current) => ({ ...current, connection: "connecting" }))
      const url = new URL("/api/live", window.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      socket = new WebSocket(url)
      socket.onopen = () => { attempt = 0 }
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return
        let parsed: unknown
        try { parsed = JSON.parse(message.data) } catch { return }
        if (!parsed || typeof parsed !== "object") return
        const data = parsed as Record<string, unknown>
        if (data.version !== 1) return

        if (data.type === "hello" && (data.mode === "memory" || data.mode === "postgres")) {
          setState((current) => ({ ...current, persistence: data.mode as "memory" | "postgres", connection: "connected" }))
        } else if (data.type === "snapshot" && Array.isArray(data.events)) {
          const events = data.events.filter(isPacket).slice(-512)
          setState((current) => applyLiveSnapshot(current, events))
        } else if (data.type === "packet" && isPacket(data.event)) {
          setState((current) => applyLivePacket(current, data.event as PacketEnvelope))
        } else if (data.type === "gap" && typeof data.session_id === "string" && typeof data.expected_record === "string" && typeof data.actual_record === "string") {
          setState((current) => ({ ...current, gaps: [...current.gaps, {
            sessionId: data.session_id as string,
            expectedRecord: data.expected_record as string,
            actualRecord: data.actual_record as string,
          }].slice(-16) }))
        }
      }
      socket.onclose = () => {
        if (!active) return
        setState((current) => ({ ...current, connection: "disconnected" }))
        const delay = Math.min(8_000, 500 * 2 ** attempt++)
        retry = window.setTimeout(connect, delay)
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      active = false
      if (retry !== undefined) window.clearTimeout(retry)
      socket?.close()
    }
  }, [enabled])

  return state
}

export type OverlayFeedState = {
  connection: "idle" | "connecting" | "connected" | "disconnected"
  latest: OverlayPacket | null
}

export function useOverlayFeed(enabled: boolean): OverlayFeedState {
  const [state, setState] = useState<OverlayFeedState>({ connection: "idle", latest: null })

  useEffect(() => {
    if (!enabled) {
      setState({ connection: "idle", latest: null })
      return
    }

    let active = true
    let socket: WebSocket | null = null
    let retry: number | undefined
    let attempt = 0

    const connect = () => {
      if (!active) return
      setState((current) => ({ ...current, connection: "connecting" }))
      const url = new URL("/api/overlay", window.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      socket = new WebSocket(url)
      socket.onopen = () => { attempt = 0 }
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return
        let parsed: unknown
        try { parsed = JSON.parse(message.data) } catch { return }
        if (!parsed || typeof parsed !== "object") return
        const data = parsed as Record<string, unknown>
        if (data.version !== 1) return
        if (data.type === "hello") {
          setState((current) => ({ ...current, connection: "connected" }))
        } else if (data.type === "snapshot" && Array.isArray(data.events)) {
          const latest = data.events.at(-1)
          setState((current) => ({ ...current, latest: isOverlayPacket(latest) ? latest : null, connection: "connected" }))
        } else if (data.type === "summary" && isOverlayPacket(data.event)) {
          setState((current) => ({ ...current, latest: data.event as OverlayPacket }))
        }
      }
      socket.onclose = () => {
        if (!active) return
        setState((current) => ({ ...current, connection: "disconnected" }))
        retry = window.setTimeout(connect, Math.min(8_000, 500 * 2 ** attempt++))
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      active = false
      if (retry !== undefined) window.clearTimeout(retry)
      socket?.close()
    }
  }, [enabled])

  return state
}

function isOverlayPacket(value: unknown): value is OverlayPacket {
  if (!value || typeof value !== "object") return false
  const event = value as Partial<OverlayPacket>
  return typeof event.session_id === "string" && typeof event.record === "string" &&
    typeof event.timestamp_ns === "string" && typeof event.kind === "string" && typeof event.status === "string"
}
