import { describe, expect, it } from "bun:test"
import { SQL } from "bun"
import { websocket } from "@hono/bun"
import { createApp } from "./app"
import { LiveStore } from "./live-store"
import { openPostgresPersistence } from "./postgres"
import { samplePacket } from "./test-fixture"

const url = process.env.INKSCOPE_TEST_DATABASE_URL

describe.skipIf(!url)("PostgreSQL replay readback", () => {
  it("counts the saved rows through a cursor even when record numbers have gaps", async () => {
    const db = await openPostgresPersistence(url!)
    const cleanup = new SQL(url!)
    const session = crypto.randomUUID()
    try {
      for (const record of ["3", "7", "11"]) expect(await db.save(samplePacket(record, session))).toBe(true)
      expect(await db.countEventsThrough(session, "2")).toBe(0)
      expect(await db.countEventsThrough(session, "7")).toBe(2)
      expect(await db.countEventsThrough(session, "10")).toBe(2)
      expect(await db.countEventsThrough(session, "11")).toBe(3)
    } finally {
      await cleanup`DELETE FROM inkscope_packet_events WHERE session_id = ${session}::uuid`
      await cleanup.close()
      await db.close()
    }
  })

  it("stores exact u64 values, deduplicates records, and reads events back", async () => {
    const db = await openPostgresPersistence(url!)
    const cleanup = new SQL(url!)
    const session = crypto.randomUUID()
    const event = samplePacket("18446744073709551615", session)
    try {
      expect(await db.save(event)).toBe(true)
      expect(await db.save(event)).toBe(false)
      expect(await db.lastRecord(session)).toBe(event.record)
      expect(await db.readEvents(session, null, 10)).toEqual([event])
      expect(await db.sessionSummary(session)).toEqual({
        session_id: session, events: "1", first_timestamp_ns: event.timestamp_ns, last_timestamp_ns: event.timestamp_ns,
      })
      expect(await db.sessionSummary(crypto.randomUUID())).toBeNull()
      expect((await db.listSessions()).some((item) => item.session_id === session && item.events === "1")).toBe(true)
      const app = createApp({ store: new LiveStore({ persistence: db }), replay: db })
      const sessionsResponse = await app.request("http://127.0.0.1:10252/api/sessions")
      expect(sessionsResponse.status).toBe(200)
      expect((await sessionsResponse.json() as { sessions: Array<{ session_id: string }> }).sessions.some((item) => item.session_id === session)).toBe(true)
      const eventsResponse = await app.request(`http://127.0.0.1:10252/api/sessions/${session}/events`)
      expect(eventsResponse.status).toBe(200)
      expect((await eventsResponse.json() as { events: unknown[] }).events).toEqual([event])
    } finally {
      await cleanup`DELETE FROM inkscope_packet_events WHERE session_id = ${session}::uuid`
      await cleanup.close()
      await db.close()
    }
  })

  it("acknowledges a publisher only after its packet can be read back", async () => {
    const db = await openPostgresPersistence(url!)
    const cleanup = new SQL(url!)
    const session = crypto.randomUUID()
    const event = samplePacket("1", session)
    const app = createApp({ store: new LiveStore({ persistence: db }), ingestToken: "test-token", replay: db })
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket })
    let socket: WebSocket | undefined
    try {
      socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/ingest`, { headers: { Authorization: "Bearer test-token" } })
      await new Promise<void>((resolve, reject) => {
        socket!.addEventListener("open", () => resolve(), { once: true })
        socket!.addEventListener("error", () => reject(new Error("Publisher handshake failed")), { once: true })
      })
      const receipt = new Promise<Record<string, unknown>>((resolve) => socket!.addEventListener("message", (message) => resolve(JSON.parse(String(message.data))), { once: true }))
      socket.send(JSON.stringify(event))
      expect(await receipt).toMatchObject({ type: "ack", record: "1", result: "accepted", persistence: "postgres" })
      expect(await db.readEvents(session, null, 10)).toEqual([event])
    } finally {
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        const closed = new Promise<void>((resolve) => socket!.addEventListener("close", () => resolve(), { once: true }))
        socket.close()
        await closed
      }
      const port = server.port
      void server.stop(true)
      const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("probe") })
      await probe.stop(true)
      await cleanup`DELETE FROM inkscope_packet_events WHERE session_id = ${session}::uuid`
      await cleanup.close()
      await db.close()
    }
  })
})
