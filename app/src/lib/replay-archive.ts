import { useCallback, useEffect, useRef, useState } from "react"
import { parsePacketEnvelope, type PacketEnvelope } from "../../../api/wire"
import type { ReplaySession } from "@/views/replay-view"

export const replayBatchSize = 500

type Selection = { sessionId: string; afterRecord: string | null; startIndex: number }
type Loaded = { key: string; cursor: string | null; events: PacketEnvelope[] }

function selectionKey(selection: Selection): string {
  return `${selection.sessionId}:${selection.afterRecord ?? "start"}`
}

/** Accept record gaps, but reject a duplicate, out-of-order record, or a crossed session. */
export function parseReplayBatch(raw: unknown, sessionId: string, afterRecord: string | null): PacketEnvelope[] {
  if (!Array.isArray(raw)) throw new Error("Invalid replay events")
  const events = raw.map((value) => parsePacketEnvelope(JSON.stringify(value)))
  events.forEach((event, index) => {
    const record = BigInt(event.record)
    const previous = index === 0 ? afterRecord === null ? null : BigInt(afterRecord) : BigInt(events[index - 1]!.record)
    if (event.session_id !== sessionId || previous !== null && record <= previous) {
      throw new Error("Invalid replay event order")
    }
  })
  return events
}

export function useReplayArchive(
  enabled: boolean,
  preferredSessionId: string | null = null,
  preferredAfterRecord: string | null = null,
  preferredStartIndex = 0,
) {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectedEvents, setSelectedEvents] = useState<PacketEnvelope[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const manualSelection = useRef(0)
  const generation = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const loaded = useRef<Loaded | null>(null)
  const sessionsUrl = preferredSessionId
    ? `/api/sessions?include_session_id=${encodeURIComponent(preferredSessionId)}`
    : "/api/sessions"
  const selectedTotal = sessions.find((session) => session.session_id === selection?.sessionId)?.events ?? null

  useEffect(() => { manualSelection.current = 0 }, [preferredSessionId, preferredAfterRecord, preferredStartIndex])

  useEffect(() => {
    if (!enabled) {
      setSessionsLoading(false)
      return
    }
    const controller = new AbortController()
    const manualAtRequest = manualSelection.current
    setSessionsLoading(true)
    setError(null)
    void fetch(sessionsUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ sessions: ReplaySession[] }>
      })
      .then((data) => {
        if (!Array.isArray(data.sessions)) throw new Error("Invalid sessions")
        if (controller.signal.aborted) return
        setSessions(data.sessions)
        if (preferredSessionId && !data.sessions.some((session) => session.session_id === preferredSessionId)) {
          setSelection(null)
          setSelectedEvents([])
          loaded.current = null
          setError("Recorded session unavailable")
        } else if (preferredSessionId && manualSelection.current === 0 && manualSelection.current === manualAtRequest) {
          setSelection((current) => current?.sessionId === preferredSessionId
            && current.afterRecord === preferredAfterRecord && current.startIndex === preferredStartIndex
            ? current : { sessionId: preferredSessionId, afterRecord: preferredAfterRecord, startIndex: preferredStartIndex })
        } else {
          setSelection((current) => current && data.sessions.some((session) => session.session_id === current.sessionId)
            ? current : data.sessions[0] ? { sessionId: data.sessions[0].session_id, afterRecord: null, startIndex: 0 } : null)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Fetch failed")
      })
      .finally(() => { if (!controller.signal.aborted) setSessionsLoading(false) })
    return () => controller.abort()
  }, [enabled, preferredSessionId, preferredAfterRecord, preferredStartIndex, sessionsUrl, retryCount])

  useEffect(() => {
    if (!enabled || !selection) {
      setEventsLoading(false)
      return
    }
    const controller = new AbortController()
    const currentGeneration = ++generation.current
    activeRequest.current = controller
    const key = selectionKey(selection)
    const previous = loaded.current?.key === key ? loaded.current : null
    const buffer = previous ? [...previous.events] : []
    const loadState = { cursor: previous?.cursor ?? selection.afterRecord }
    if (!previous) {
      loaded.current = { key, cursor: loadState.cursor, events: [] }
      setSelectedEvents([])
    }
    setEventsLoading(true)
    setError(null)

    void (async () => {
      try {
        for (;;) {
          const cursorQuery = loadState.cursor === null ? "" : `&after_record=${encodeURIComponent(loadState.cursor)}`
          const url = `/api/sessions/${encodeURIComponent(selection.sessionId)}/events?limit=${replayBatchSize}${cursorQuery}`
          const response = await fetch(url, { signal: controller.signal })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json() as { events?: unknown }
          if (controller.signal.aborted || currentGeneration !== generation.current) return
          const batch = parseReplayBatch(data.events, selection.sessionId, loadState.cursor)
          if (batch.length === 0) break
          buffer.push(...batch)
          loadState.cursor = batch.at(-1)!.record
          loaded.current = { key, cursor: loadState.cursor, events: buffer }
          setSelectedEvents([...buffer])
          if (selectedTotal !== null && BigInt(selection.startIndex + buffer.length) >= BigInt(selectedTotal)) break
          if (batch.length < replayBatchSize) break
        }
      } catch (cause: unknown) {
        if (!controller.signal.aborted && currentGeneration === generation.current) {
          setError(cause instanceof Error ? cause.message : "Fetch failed")
        }
      } finally {
        if (!controller.signal.aborted && currentGeneration === generation.current) {
          activeRequest.current = null
          setEventsLoading(false)
        }
      }
    })()
    return () => {
      controller.abort()
      if (activeRequest.current === controller) activeRequest.current = null
      generation.current++
    }
  }, [enabled, selection, retryCount, selectedTotal])

  useEffect(() => {
    if (!enabled || !selection) return
    const controller = new AbortController()
    const pending = { current: false }
    const timer = window.setInterval(() => {
      if (pending.current) return
      pending.current = true
      void fetch(sessionsUrl, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json() as Promise<{ sessions: ReplaySession[] }>
        })
        .then((data) => {
          if (controller.signal.aborted || !Array.isArray(data.sessions)) return
          setSessions((current) => {
            const selected = current.find((session) => session.session_id === selection.sessionId)
            return selected && !data.sessions.some((session) => session.session_id === selection.sessionId)
              ? [selected, ...data.sessions] : data.sessions
          })
        })
        .catch(() => undefined)
        .finally(() => { pending.current = false })
    }, 5_000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [enabled, selection?.sessionId, sessionsUrl])

  const selectSession = useCallback((sessionId: string) => {
    manualSelection.current++
    if (sessionId === selection?.sessionId) return
    activeRequest.current?.abort()
    generation.current++
    loaded.current = null
    setSelectedEvents([])
    setError(null)
    setEventsLoading(true)
    setSelection(sessionId === preferredSessionId
      ? { sessionId, afterRecord: preferredAfterRecord, startIndex: preferredStartIndex }
      : { sessionId, afterRecord: null, startIndex: 0 })
  }, [selection?.sessionId, preferredSessionId, preferredAfterRecord, preferredStartIndex])

  const retry = useCallback(() => {
    if (sessionsLoading || eventsLoading) return
    setRetryCount((current) => current + 1)
  }, [sessionsLoading, eventsLoading])

  return {
    sessions,
    selectedSessionId: selection?.sessionId ?? null,
    selectedEvents,
    loading: sessionsLoading || eventsLoading,
    error,
    startIndex: selection?.startIndex ?? 0,
    selectSession,
    retry,
  }
}
