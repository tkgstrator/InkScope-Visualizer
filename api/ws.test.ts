/// <reference types="bun" />
import { afterEach, describe, expect, it } from "bun:test"
import { websocket } from "@hono/bun"
import { createApp } from "./app"
import { LiveStore } from "./live-store"
import { samplePacket } from "./test-fixture"

type Peer = {
  ws: WebSocket
  opened: Promise<void>
  next: () => Promise<Record<string, unknown>>
}

function peer(url: string, headers: Record<string, string> = {}): Peer {
  const ws = new WebSocket(url, { headers })
  const queue: Record<string, unknown>[] = []
  const waiters: Array<(message: Record<string, unknown>) => void> = []
  let resolveOpen!: () => void
  let rejectOpen!: (error: Error) => void
  const opened = new Promise<void>((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject })
  ws.addEventListener("open", () => resolveOpen())
  ws.addEventListener("error", () => rejectOpen(new Error("WebSocket rejected")))
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>
    const waiter = waiters.shift()
    if (waiter) waiter(message)
    else queue.push(message)
  })
  return {
    ws,
    opened,
    next: () => queue.length ? Promise.resolve(queue.shift()!) : Promise.race([
      new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WebSocket message timeout")), 2_000)),
    ]),
  }
}

const servers: Array<ReturnType<typeof Bun.serve>> = []
const sockets: WebSocket[] = []

afterEach(async () => {
  await Promise.all(sockets.splice(0).map((socket) => new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve()
    socket.addEventListener("close", () => resolve(), { once: true })
    socket.close()
    setTimeout(() => { if (socket.readyState !== WebSocket.CLOSED) socket.terminate(); resolve() }, 1_000)
  })))
  await Bun.sleep(100)
  for (const server of servers.splice(0)) {
    const port = server.port
    // Bun 1.3.11 can leave stop(true)'s promise pending after a server-initiated
    // WebSocket close. Verify that its listener actually released the port.
    void server.stop(true)
    const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("probe") })
    await probe.stop(true)
  }
})

describe("Hono live WebSocket ingress", () => {
  it("requires a token and streams only validated packets to read-only clients", async () => {
    const store = new LiveStore()
    const app = createApp({ store, ingestToken: "test-token" })
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket })
    servers.push(server)
    const origin = `http://127.0.0.1:${server.port}`
    const url = `ws://127.0.0.1:${server.port}`

    const unauthorized = await app.request(`${origin}/api/ingest`, { headers: { Origin: origin } })
    expect(unauthorized.status).toBe(401)
    const foreign = await app.request(`${origin}/api/live`, { headers: { Origin: "https://other.example" } })
    expect(foreign.status).toBe(403)
    const foreignPublisher = await app.request(`${origin}/api/ingest`, { headers: { Origin: "https://other.example", Authorization: "Bearer test-token" } })
    expect(foreignPublisher.status).toBe(403)

    const live = peer(`${url}/api/live`, { Origin: origin })
    sockets.push(live.ws)
    await live.opened
    expect(await live.next()).toEqual({ version: 1, type: "hello", mode: "memory" })
    expect(await live.next()).toEqual({ version: 1, type: "snapshot", events: [] })

    const overlay = peer(`${url}/api/overlay`, { Origin: origin })
    sockets.push(overlay.ws)
    await overlay.opened
    await overlay.next()
    await overlay.next()

    const ingest = peer(`${url}/api/ingest`, { Authorization: "Bearer test-token" })
    sockets.push(ingest.ws)
    await ingest.opened
    const event = samplePacket()
    ingest.ws.send(JSON.stringify(event))
    expect(await ingest.next()).toEqual({ version: 1, type: "ack", session_id: event.session_id, record: event.record, result: "accepted", persistence: "memory" })
    expect(await live.next()).toEqual({ version: 1, type: "packet", event })
    const summary = await overlay.next()
    expect(summary.type).toBe("summary")
    expect(JSON.stringify(summary)).not.toContain("payload_hex")
    expect(JSON.stringify(summary)).not.toContain("fields")

    ingest.ws.send(JSON.stringify(event))
    expect((await ingest.next()).result).toBe("duplicate")
    ingest.ws.send("{")
    expect(await ingest.next()).toEqual({ version: 1, type: "error", code: "invalid_packet" })
    expect(store.snapshot()).toEqual([event])
    live.ws.send("publisher attempt")
    const closed = await new Promise<number>((resolve) => live.ws.addEventListener("close", (event) => resolve(event.code), { once: true }))
    expect(closed).toBe(1008)
  })
})
