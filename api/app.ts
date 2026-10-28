import { resolve } from "node:path"
import { serveStatic, upgradeWebSocket } from "@hono/bun"
import { Hono } from "hono"
import type { WSContext } from "hono/ws"
import { registerControlRoutes } from "./control"
import { IngressBusyError, LiveStore, type LiveMessage, type OverlayMessage } from "./live-store"
import type { PostgresPersistence } from "./postgres"
import { maxWireBytes, parsePacketEnvelope, WireValidationError } from "./wire"

export const distDir = resolve(import.meta.dirname, "../app/dist")
export const indexPath = resolve(distDir, "index.html")
export const localTerrainDir = resolve(import.meta.dirname, "../app/public/maps/local")
export const localTerrainPath = resolve(localTerrainDir, "cop-shakedent.glb")
export const localFontDir = resolve(import.meta.dirname, "../app/public/local-fonts")
const localFontNames = new Set(["splatoon1-common.woff2", "splatoon2-common.woff2"])
const localTerrainNames = new Set([
  "cop-carousel.glb", "cop-district00.glb", "cop-factory.glb", "cop-manbou00.glb",
  "cop-section.glb", "cop-shakedent.glb", "cop-shakehighway.glb", "cop-shakelift.glb",
  "cop-shakerail.glb", "cop-shakeship.glb", "cop-shakespiral.glb", "cop-shakeup.glb",
  "cop-temple.glb", "cop-upland.glb",
])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const decimalU64Pattern = /^(0|[1-9][0-9]{0,19})$/
const maxSampleResponseBytes = 8 * 1024 * 1024
const sampleBatchSize = 32
const maxSampleEvents = 1200

export type RecordedSampleConfig = { sessionId: string; afterRecord: string }

export function readSampleConfig(env: Record<string, string | undefined>): RecordedSampleConfig | undefined {
  const sessionId = env.INKSCOPE_SAMPLE_SESSION_ID
  const afterRecord = env.INKSCOPE_SAMPLE_AFTER_RECORD
  if (sessionId === undefined && afterRecord === undefined) return undefined
  if (!sessionId || !afterRecord || !uuidPattern.test(sessionId) || !decimalU64Pattern.test(afterRecord)
    || BigInt(afterRecord) > 18_446_744_073_709_551_615n) {
    throw new Error("Invalid recorded sample configuration")
  }
  return { sessionId, afterRecord }
}

function localHostAllowed(requestUrl: string, hostHeader: string | undefined): boolean {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) return false
    return hostHeader === undefined || hostHeader.toLowerCase() === url.host.toLowerCase()
  } catch {
    return false
  }
}

function originAllowed(origin: string | undefined, requestUrl: string): boolean {
  if (origin === undefined) return true
  try {
    const claimed = new URL(origin)
    const actual = new URL(requestUrl)
    return claimed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(claimed.hostname)
      && ["localhost", "127.0.0.1"].includes(actual.hostname)
      && claimed.port === actual.port
  } catch {
    return false
  }
}

function sendJson(ws: WSContext, message: LiveMessage | OverlayMessage | Record<string, unknown>): boolean {
  const socket = ws.raw as Bun.ServerWebSocket | undefined
  if (!socket || socket.readyState !== 1) return false
  if (socket.getBufferedAmount() > 1024 * 1024) {
    ws.close(1013, "Slow reader")
    return false
  }
  const status = socket.send(JSON.stringify(message))
  if (status <= 0) {
    ws.close(1013, "Slow reader")
    return false
  }
  return true
}

function clientSnapshot<T>(events: T[], maxEvents = 64): T[] {
  const selected: T[] = []
  let bytes = 0
  for (let index = events.length - 1; index >= 0 && selected.length < maxEvents; index--) {
    const event = events[index]!
    const size = new TextEncoder().encode(JSON.stringify(event)).byteLength
    if (bytes + size > 512 * 1024) break
    selected.unshift(event)
    bytes += size
  }
  return selected
}

export function createApp(options: { store?: LiveStore; ingestToken?: string | null; controlToken?: string | null; replay?: PostgresPersistence; sample?: RecordedSampleConfig } = {}) {
  const store = options.store ?? new LiveStore()
  const ingestToken = options.ingestToken ?? null
  const replay = options.replay
  const app = new Hono()
  app.use("*", async (context, next) => {
    if (!localHostAllowed(context.req.url, context.req.header("host"))) return context.json({ error: "Forbidden host" }, 403)
    await next()
  })
  registerControlRoutes(app, options.controlToken)

  app.get("/api/status", (context) => context.json({
    version: 1,
    mode: store.mode,
    ingest_enabled: Boolean(ingestToken),
    retained_events: store.snapshot().length,
    connected_clients: store.listenerCount,
  }))

  app.get("/api/sample", async (context) => {
    context.header("Cache-Control", "private, no-store")
    if (!options.sample) return context.json({ version: 1, state: "unavailable" })
    if (!replay) return context.json({ error: "Recorded sample storage unavailable" }, 503)
    const { sessionId, afterRecord } = options.sample
    try {
      let batch = await replay.readEvents(sessionId, afterRecord, sampleBatchSize)
      if (batch.length === 0) return context.json({ version: 1, state: "empty", session_id: sessionId, after_record: afterRecord })
      const startIndex = await replay.countEventsThrough(sessionId, afterRecord)
      const base = { version: 1, state: "ready", session_id: sessionId, after_record: afterRecord, start_index: startIndex }
      const selected: typeof batch = []
      const encoder = new TextEncoder()
      let bytes = encoder.encode(JSON.stringify({ ...base, events: selected })).byteLength
      let readCount = 0
      let cursor = afterRecord
      let full = false
      while (batch.length > 0) {
        const requested = Math.min(sampleBatchSize, maxSampleEvents - readCount)
        const bounded = batch.slice(0, requested)
        readCount += bounded.length
        for (const event of bounded) {
          const eventBytes = encoder.encode(JSON.stringify(event)).byteLength
          if (bytes + eventBytes + (selected.length > 0 ? 1 : 0) > maxSampleResponseBytes) { full = true; break }
          selected.push(event)
          bytes += eventBytes + (selected.length > 1 ? 1 : 0)
        }
        if (full || readCount >= maxSampleEvents || bounded.length < requested) break
        cursor = bounded.at(-1)!.record
        batch = await replay.readEvents(sessionId, cursor, Math.min(sampleBatchSize, maxSampleEvents - readCount))
      }
      if (selected.length === 0) return context.json({ error: "Recorded sample event too large" }, 413)
      return context.json({ ...base, events: selected })
    } catch {
      return context.json({ error: "Recorded sample read failed" }, 503)
    }
  })

  app.get("/api/sessions", async (context) => {
    if (!replay) return context.json({ error: "Replay storage unavailable in memory mode" }, 503)
    const included = new URL(context.req.url).searchParams.getAll("include_session_id")
    if (included.length > 1 || included.length === 1 && !uuidPattern.test(included[0]!)) {
      return context.json({ error: "Invalid session query" }, 400)
    }
    const sessions = await replay.listSessions()
    const requestedId = included[0]
    if (requestedId && !sessions.some((session) => session.session_id === requestedId)) {
      const additional = await replay.sessionSummary(requestedId)
      if (additional) sessions.push(additional)
    }
    return context.json({ version: 1, sessions })
  })

  app.get("/api/sessions/:sessionId/events", async (context) => {
    if (!replay) return context.json({ error: "Replay storage unavailable in memory mode" }, 503)
    const sessionId = context.req.param("sessionId")
    const afterRecord = context.req.query("after_record") ?? null
    const rawLimit = context.req.query("limit") ?? "100"
    if (!uuidPattern.test(sessionId)
      || afterRecord !== null && (!decimalU64Pattern.test(afterRecord) || BigInt(afterRecord) > 18_446_744_073_709_551_615n)
      || !/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 500) {
      return context.json({ error: "Invalid replay query" }, 400)
    }
    const events = await replay.readEvents(sessionId, afterRecord, Number(rawLimit))
    return context.json({ version: 1, session_id: sessionId, events, next_record: events.at(-1)?.record ?? afterRecord })
  })

  app.get("/api/ingest", (context, next) => {
    if (!originAllowed(context.req.header("origin"), context.req.url)) return context.json({ error: "Forbidden origin" }, 403)
    if (!ingestToken) return context.json({ error: "InkScope ingest is disabled until INKSCOPE_VISUALIZER_TOKEN is configured" }, 503)
    if (context.req.header("authorization") !== `Bearer ${ingestToken}`) return context.json({ error: "Unauthorized" }, 401)
    return next()
  }, upgradeWebSocket(() => ({
    onMessage(event, ws) {
      if (typeof event.data !== "string") {
        sendJson(ws, { version: 1, type: "error", code: "text_required" })
        ws.close(1003, "Text JSON required")
        return
      }
      const raw = event.data
      void (async () => {
        try {
          if (new TextEncoder().encode(raw).byteLength > maxWireBytes) {
            ws.close(1009, "Message too large")
            return
          }
          const packet = parsePacketEnvelope(raw)
          const result = await store.ingest(packet)
          sendJson(ws, { version: 1, type: "ack", session_id: packet.session_id, record: packet.record, result: result.result, persistence: result.persistence })
        } catch (error) {
          if (error instanceof WireValidationError) {
            sendJson(ws, { version: 1, type: "error", code: "invalid_packet" })
            ws.close(1007, "Invalid packet")
          } else if (error instanceof IngressBusyError) {
            ws.close(1013, "Ingress busy")
          } else {
            const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown"
            console.error(`InkScope persistence/ingest failed (${code})`)
            sendJson(ws, { version: 1, type: "error", code: "ingest_failed" })
            ws.close(1011, "Ingest failed")
          }
        }
      })()
    },
  })))

  for (const kind of ["live", "overlay"] as const) {
    app.get(`/api/${kind}`, (context, next) => {
      if (!originAllowed(context.req.header("origin"), context.req.url)) return context.json({ error: "Forbidden origin" }, 403)
      return next()
    }, upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined
      return {
        onOpen(_event, ws) {
          sendJson(ws, { version: 1, type: "hello", mode: store.mode })
          if (kind === "live") sendJson(ws, { version: 1, type: "snapshot", events: clientSnapshot(store.snapshot()) })
          else sendJson(ws, { version: 1, type: "snapshot", events: clientSnapshot(store.overlaySnapshot()) })
          unsubscribe = store.subscribe(kind, (message) => sendJson(ws, message))
        },
        onMessage(_event, ws) {
          ws.close(1008, "Read-only stream")
        },
        onClose() {
          unsubscribe?.()
        },
      }
    }))
  }

  app.on(["GET", "HEAD"], "/maps/local/:name", async (context) => {
    const name = context.req.param("name")
    if (!localTerrainNames.has(name)) return context.notFound()
    const terrain = Bun.file(resolve(localTerrainDir, name))
    if (!(await terrain.exists())) return context.notFound()
    return new Response(context.req.method === "HEAD" ? null : terrain, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(terrain.size),
        "Cache-Control": "private, max-age=3600, must-revalidate",
      },
    })
  })

  app.on(["GET", "HEAD"], "/local-fonts/:name", async (context) => {
    const name = context.req.param("name")
    if (!localFontNames.has(name)) return context.notFound()
    const font = Bun.file(resolve(localFontDir, name))
    if (!(await font.exists())) return context.notFound()
    return new Response(context.req.method === "HEAD" ? null : font, {
      headers: {
        "Content-Type": "font/woff2",
        "Content-Length": String(font.size),
        "Cache-Control": "private, max-age=3600, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })

  app.use(
    "*",
    serveStatic({
      root: distDir,
      onFound: (path, context) => {
        context.header(
          "Cache-Control",
          path.startsWith(resolve(distDir, "assets") + "/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        )
      },
    }),
  )

  app.on(["GET", "HEAD"], ["*"], (context) => {
    const path = context.req.path
    if (path.startsWith("/api/") || path === "/api" || /\.[^/]+$/.test(path)) {
      return context.notFound()
    }
    return new Response(Bun.file(indexPath), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    })
  })

  return app
}

export const app = createApp()
