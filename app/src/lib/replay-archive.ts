import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { parsePacketEnvelope, type PacketEnvelope } from "../../../api/wire"
import type { ReplaySession } from "@/views/replay-view"

export const replayPageSize = 100
const minimumDelayMs = 50
const maximumDelayMs = 2_000

type PageCursor = { afterRecord: string | null; startIndex: number }

export function hasNextReplayPage(total: string, startIndex: number, loaded: number): boolean {
  if (loaded === 0) return false
  try {
    return BigInt(startIndex) + BigInt(loaded) < BigInt(total)
  } catch {
    return false
  }
}

/** Capture-time delay from the current record to the next record on this page. */
export function replayDelayMs(events: readonly PacketEnvelope[], currentIndex: number): number | null {
  const current = events[currentIndex]
  const next = events[currentIndex + 1]
  if (!current || !next) return null
  try {
    const deltaNs = BigInt(next.timestamp_ns) - BigInt(current.timestamp_ns)
    if (deltaNs <= 0n) return minimumDelayMs
    const maxNs = BigInt(maximumDelayMs) * 1_000_000n
    if (deltaNs >= maxNs) return maximumDelayMs
    return Math.max(minimumDelayMs, Number(deltaNs / 1_000_000n))
  } catch {
    return minimumDelayMs
  }
}

export function useReplayArchive(
  enabled: boolean,
  preferredSessionId: string | null = null,
  preferredAfterRecord: string | null = null,
  preferredStartIndex = 0,
) {
  const [sessions, setSessions] = useState<ReplaySession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedEvents, setSelectedEvents] = useState<PacketEnvelope[]>([])
  const [nextEvent, setNextEvent] = useState<PacketEnvelope | null>(null)
  const [cursor, setCursor] = useState<PageCursor>({ afterRecord: null, startIndex: 0 })
  const [previousPages, setPreviousPages] = useState<PageCursor[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [eventsLoading, setEventsLoading] = useState(false)
  const loading = sessionsLoading || eventsLoading
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const generation = useRef(0)
  const manualSelection = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const sessionsUrl = preferredSessionId
    ? `/api/sessions?include_session_id=${encodeURIComponent(preferredSessionId)}`
    : "/api/sessions"

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
          setSelectedSessionId(null)
          setSelectedEvents([])
          setNextEvent(null)
          setError("Recorded session unavailable")
        } else if (preferredSessionId && manualSelection.current === manualAtRequest) {
          setSelectedSessionId(preferredSessionId)
          setCursor({ afterRecord: preferredAfterRecord, startIndex: preferredStartIndex })
          setPreviousPages([])
          setSelectedEvents([])
          setNextEvent(null)
        } else {
          setSelectedSessionId((current) => current && data.sessions.some((session) => session.session_id === current) ? current : data.sessions[0]?.session_id ?? null)
        }
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Fetch failed") })
      .finally(() => { if (!controller.signal.aborted) setSessionsLoading(false) })
    return () => controller.abort()
  }, [enabled, preferredSessionId, preferredAfterRecord, preferredStartIndex, sessionsUrl])

  useEffect(() => {
    if (!enabled || !selectedSessionId) return
    const controller = new AbortController()
    let pending = false
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      void fetch(sessionsUrl, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.json() as Promise<{ sessions: ReplaySession[] }>
        })
        .then((data) => {
          if (controller.signal.aborted || !Array.isArray(data.sessions)) return
          setSessions((current) => {
            const selected = current.find((session) => session.session_id === selectedSessionId)
            return selected && !data.sessions.some((session) => session.session_id === selectedSessionId)
              ? [selected, ...data.sessions]
              : data.sessions
          })
        })
        .catch(() => undefined)
        .finally(() => { pending = false })
    }, 5_000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [enabled, selectedSessionId, sessionsUrl])

  useEffect(() => {
    if (!enabled || !selectedSessionId) {
      pending.current = false
      setEventsLoading(false)
      setSelectedEvents([])
      setNextEvent(null)
      return
    }
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    activeRequest.current = controller
    pending.current = true
    setEventsLoading(true)
    setError(null)
    setSelectedEvents([])
    setNextEvent(null)
    const cursorQuery = cursor.afterRecord === null ? "" : `&after_record=${encodeURIComponent(cursor.afterRecord)}`
    const url = `/api/sessions/${encodeURIComponent(selectedSessionId)}/events?limit=${replayPageSize + 1}${cursorQuery}`
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<{ events: PacketEnvelope[] }>
      })
      .then((data) => {
        if (controller.signal.aborted || currentGeneration !== generation.current) return
        if (!Array.isArray(data.events)) throw new Error("Invalid events")
        const page = data.events.slice(0, replayPageSize).map((event) => parsePacketEnvelope(JSON.stringify(event)))
        let lookahead: PacketEnvelope | null = null
        if (data.events[replayPageSize]) {
          try { lookahead = parsePacketEnvelope(JSON.stringify(data.events[replayPageSize])) }
          catch { /* The next page will show the malformed record when it becomes visible. */ }
        }
        setSelectedEvents(page)
        setNextEvent(lookahead)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && currentGeneration === generation.current) setError(cause instanceof Error ? cause.message : "Fetch failed")
      })
      .finally(() => {
        if (controller.signal.aborted || currentGeneration !== generation.current) return
        activeRequest.current = null
        pending.current = false
        setEventsLoading(false)
      })
    return () => {
      controller.abort()
      if (activeRequest.current === controller) activeRequest.current = null
      generation.current++
      pending.current = false
    }
  }, [enabled, selectedSessionId, cursor])

  const selectedSession = sessions.find((session) => session.session_id === selectedSessionId)
  const hasMore = useMemo(() => selectedSession ? hasNextReplayPage(selectedSession.events, cursor.startIndex, selectedEvents.length) : false,
    [selectedSession, cursor.startIndex, selectedEvents.length])

  const selectSession = useCallback((sessionId: string) => {
    manualSelection.current++
    if (sessionId === selectedSessionId) return
    activeRequest.current?.abort()
    activeRequest.current = null
    generation.current++
    pending.current = false
    setSelectedSessionId(sessionId)
    setCursor(sessionId === preferredSessionId
      ? { afterRecord: preferredAfterRecord, startIndex: preferredStartIndex }
      : { afterRecord: null, startIndex: 0 })
    setPreviousPages([])
    setSelectedEvents([])
    setNextEvent(null)
    setError(null)
    setEventsLoading(true)
  }, [selectedSessionId, preferredSessionId, preferredAfterRecord, preferredStartIndex])

  const loadMore = useCallback(() => {
    if (!enabled || !selectedSessionId || loading || pending.current || !hasMore) return
    const lastRecord = selectedEvents.at(-1)?.record
    if (!lastRecord) return
    pending.current = true
    manualSelection.current++
    setPreviousPages((current) => [...current, cursor])
    setCursor({ afterRecord: lastRecord, startIndex: cursor.startIndex + selectedEvents.length })
    setSelectedEvents([])
    setNextEvent(null)
    setEventsLoading(true)
  }, [enabled, selectedSessionId, loading, hasMore, selectedEvents, cursor])

  const loadPrevious = useCallback(() => {
    if (!enabled || !selectedSessionId || loading || pending.current || previousPages.length === 0) return
    manualSelection.current++
    const previous = previousPages.at(-1)!
    setPreviousPages((current) => current.slice(0, -1))
    setCursor(previous)
    setSelectedEvents([])
    setNextEvent(null)
    setEventsLoading(true)
  }, [enabled, selectedSessionId, loading, previousPages])

  const jumpToStart = useCallback(() => {
    if (!enabled || !selectedSessionId) return
    manualSelection.current++
    activeRequest.current?.abort()
    activeRequest.current = null
    generation.current++
    pending.current = false
    setCursor({ afterRecord: null, startIndex: 0 })
    setPreviousPages([])
    setSelectedEvents([])
    setNextEvent(null)
    setError(null)
    setEventsLoading(true)
  }, [enabled, selectedSessionId])

  return {
    sessions, selectedSessionId, selectedEvents, nextEvent, loading, error, hasMore,
    hasPrevious: previousPages.length > 0, pageNumber: previousPages.length + 1,
    pageStartIndex: cursor.startIndex, selectSession, loadMore, loadPrevious, jumpToStart,
  }
}
