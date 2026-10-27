import { useEffect, useState } from "react"
import type { OverlayPacket, PacketEnvelope } from "../../../api/wire"

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
}

const emptyFeed: LiveFeedState = {
  connection: "idle",
  persistence: null,
  events: [],
  gaps: [],
}

function isPacket(value: unknown): value is PacketEnvelope {
  if (!value || typeof value !== "object") return false
  const event = value as Partial<PacketEnvelope>
  return event.version === 1 && event.type === "packet" &&
    typeof event.session_id === "string" && typeof event.record === "string" &&
    typeof event.timestamp_ns === "string" && Array.isArray(event.rows) &&
    Boolean(event.packet && typeof event.packet.payload_hex === "string")
}

function sameRecord(left: PacketEnvelope, right: PacketEnvelope): boolean {
  return left.session_id === right.session_id && left.record === right.record
}

export function useLiveFeed(enabled: boolean): LiveFeedState {
  const [state, setState] = useState<LiveFeedState>(emptyFeed)

  useEffect(() => {
    if (!enabled) {
      setState(emptyFeed)
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
          setState((current) => ({ ...current, events, connection: "connected" }))
        } else if (data.type === "packet" && isPacket(data.event)) {
          const event = data.event
          setState((current) => sameRecord(current.events.at(-1) ?? event, event)
            ? current.events.length === 0 ? { ...current, events: [event] } : current
            : { ...current, events: [...current.events.filter((item) => !sameRecord(item, event)), event].slice(-512) })
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
