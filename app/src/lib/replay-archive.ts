import { useCallback, useEffect, useRef, useState } from "react"
import type { PacketEnvelope } from "../../../api/wire"
import type { ReplaySession } from "@/views/replay-view"

const pageSize = 100

export function useReplayArchive(enabled: boolean) {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<PacketEnvelope[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetch("/api/sessions", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ sessions: ReplaySession[] }>
      })
      .then((data) => {
        if (!Array.isArray(data.sessions)) throw new Error("Invalid sessions")
        setSessions(data.sessions)
        setSelectedSessionId((current) => current && data.sessions.some((session) => session.session_id === current) ? current : data.sessions[0]?.session_id ?? null)
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Fetch failed") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [enabled])

  useEffect(() => {
    if (!enabled || !selectedSessionId) return
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    pending.current = true
    setLoading(true)
    setError(null)
    setEvents([])
    setHasMore(false)
    const url = `/api/sessions/${encodeURIComponent(selectedSessionId)}/events?limit=${pageSize}`
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ events: PacketEnvelope[] }>
      })
      .then((data) => {
        if (currentGeneration !== generation.current) return
        if (!Array.isArray(data.events)) throw new Error("Invalid events")
        setEvents(data.events)
        setHasMore(data.events.length === pageSize)
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted && currentGeneration === generation.current) setError(cause instanceof Error ? cause.message : "Fetch failed") })
      .finally(() => { if (currentGeneration === generation.current) { pending.current = false; setLoading(false) } })
    return () => { controller.abort(); generation.current++ }
  }, [enabled, selectedSessionId])

  const loadMore = useCallback(() => {
    if (!enabled || !selectedSessionId || pending.current || !hasMore || events.length === 0) return
    pending.current = true
    setLoading(true)
    setError(null)
    const currentGeneration = generation.current
    const lastRecord = events.at(-1)!.record
    const url = `/api/sessions/${encodeURIComponent(selectedSessionId)}/events?after_record=${encodeURIComponent(lastRecord)}&limit=${pageSize}`
    void fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ events: PacketEnvelope[] }>
      })
      .then((data) => {
        if (currentGeneration !== generation.current) return
        if (!Array.isArray(data.events)) throw new Error("Invalid events")
        setEvents((current) => [...current, ...data.events])
        setHasMore(data.events.length === pageSize)
      })
      .catch((cause: unknown) => { if (currentGeneration === generation.current) setError(cause instanceof Error ? cause.message : "Fetch failed") })
      .finally(() => { if (currentGeneration === generation.current) { pending.current = false; setLoading(false) } })
  }, [enabled, selectedSessionId, hasMore, events])

  return { sessions, selectedSessionId, selectedEvents: events, loading, error, hasMore, selectSession: setSelectedSessionId, loadMore }
}
