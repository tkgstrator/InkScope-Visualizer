import { useEffect, useState } from "react"
import { parsePacketEnvelope, type PacketEnvelope } from "../../../api/wire"

export type RecordedSampleState = {
  status: "loading" | "ready" | "unavailable" | "empty" | "error"
  events: PacketEnvelope[]
  sessionId: string | null
  afterRecord: string | null
  startIndex: number | null
  error: string | null
}

const emptySample: RecordedSampleState = {
  status: "unavailable", events: [], sessionId: null, afterRecord: null, startIndex: null, error: null,
}
const loadingSample: RecordedSampleState = { ...emptySample, status: "loading" }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function invalid(): never {
  throw new Error("Invalid recorded sample response")
}

function cursor(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)
    || BigInt(value) > 18_446_744_073_709_551_615n) return invalid()
  return value
}

function selector(value: Record<string, unknown>): { sessionId: string; afterRecord: string } {
  const sessionId = value.session_id
  if (typeof sessionId !== "string" || !uuidPattern.test(sessionId)) return invalid()
  return { sessionId, afterRecord: cursor(value.after_record) }
}

export function parseRecordedSampleResponse(value: unknown): RecordedSampleState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid()
  const response = value as Record<string, unknown>
  if (response.version !== 1) return invalid()
  if (response.state === "unavailable") return emptySample
  if (response.state !== "empty" && response.state !== "ready") return invalid()
  const { sessionId, afterRecord } = selector(response)
  if (response.state === "empty") return { status: "empty", events: [], sessionId, afterRecord, startIndex: null, error: null }
  const startIndex = response.start_index
  if (typeof startIndex !== "number" || !Number.isSafeInteger(startIndex) || startIndex < 0) return invalid()
  if (!Array.isArray(response.events) || response.events.length === 0 || response.events.length > 1200) return invalid()
  try {
    const events = response.events.map((event) => parsePacketEnvelope(JSON.stringify(event)))
    let prior = BigInt(afterRecord)
    for (const event of events) {
      if (event.session_id !== sessionId || BigInt(event.record) !== prior + 1n) return invalid()
      prior = BigInt(event.record)
    }
    return { status: "ready", events, sessionId, afterRecord, startIndex, error: null }
  } catch {
    return invalid()
  }
}

export function useRecordedSample(enabled: boolean): RecordedSampleState {
  const [sample, setSample] = useState<RecordedSampleState>(enabled ? loadingSample : emptySample)

  useEffect(() => {
    if (!enabled) {
      setSample(emptySample)
      return
    }
    const controller = new AbortController()
    setSample(loadingSample)
    void fetch("/api/sample", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return parseRecordedSampleResponse(await response.json())
      })
      .then((result) => { if (!controller.signal.aborted) setSample(result) })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setSample({ ...emptySample, status: "error", error: cause instanceof Error ? cause.message : "Sample fetch failed" })
      })
    return () => controller.abort()
  }, [enabled])

  return sample
}
