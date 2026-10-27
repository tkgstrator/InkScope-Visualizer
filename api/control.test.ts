import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it } from "bun:test"
import { createApp } from "./app"

const origin = "http://127.0.0.1:10252"
const token = "test-control-token-32-byte-minimum-0001"
const instanceId = "123e4567-e89b-42d3-a456-426614174000"
const gameKey = "0123456789abcdef0123456789ABCDEF"
const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(false)
})

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { Connection: "keep-alive" } })
}

function fakeControl(options: { badProof?: boolean; redirect?: boolean; closeIdentity?: boolean; closeSecondIdentity?: boolean; slowIdentity?: boolean; relayPort?: number; locked?: boolean; rejectMutation?: boolean } = {}) {
  const calls: Array<{ path: string; authorization: string | null; body: string }> = []
  let epoch = 0
  let identities = 0
  let keyState = options.locked ? "applied" : "absent"
  let listenerPort = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = await request.text()
      calls.push({ path: url.pathname, authorization: request.headers.get("authorization"), body })
      if (url.pathname === "/control/v1/identity") {
        identities++
        if (options.slowIdentity) await Bun.sleep(2_000)
        if (options.redirect) return new Response(null, { status: 302, headers: { Location: "/leak" } })
        const nonce = url.searchParams.get("nonce") ?? ""
        const signedPort = options.relayPort ?? listenerPort
        const proof = createHmac("sha256", token).update(`inkscope-control/v1\n${nonce}\n${instanceId}\n127.0.0.1:${signedPort}`).digest("hex")
        const identity = { version: 1, service: "inkscope-control", instance_id: instanceId, host: "127.0.0.1", port: signedPort, nonce, proof: options.badProof ? "0".repeat(64) : proof }
        return options.closeIdentity || options.closeSecondIdentity && identities === 2
          ? Response.json(identity, { headers: { Connection: "close" } })
          : json(identity)
      }
      if (request.headers.get("authorization") !== `Bearer ${token}`) return json({ error: "Unauthorized" }, 401)
      if (url.pathname === "/control/v1/status") {
        return json({ version: 1, service: "inkscope-control", capture: "running", key_state: keyState, key_locked: Boolean(options.locked), key_source: options.locked ? "file" : keyState === "absent" ? "none" : "control", key_epoch: epoch, publisher: { enabled: true, connection: "connected" }, game_key: gameKey })
      }
      if (url.pathname === "/control/v1/connect") {
        if (options.rejectMutation) return json({ error: "Busy" }, 409)
        const input = JSON.parse(body) as { game_key: string }
        if (input.game_key !== gameKey.toLowerCase()) return json({ error: "Invalid key" }, 400)
        keyState = "pending"
        return json({ version: 1, service: "inkscope-control", key_state: "pending", key_epoch: ++epoch }, 202)
      }
      if (url.pathname === "/control/v1/disconnect") {
        keyState = "absent"
        return json({ version: 1, service: "inkscope-control", key_state: "pending", key_epoch: ++epoch }, 202)
      }
      return json({ error: "Not found" }, 404)
    },
  })
  if (!server.port) throw new Error("Disposable control listener did not bind")
  listenerPort = server.port
  servers.push(server)
  return { port: listenerPort, calls }
}

function post(app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`${origin}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("InkScope loopback control proxy", () => {
  it("disables control without its own token and exposes no target by default", async () => {
    const app = createApp()
    const status = await app.request(`${origin}/api/control/status`)
    expect(await status.json()).toEqual({ version: 1, state: "unconfigured", target: null, control_enabled: false })
    expect(status.headers.get("cache-control")).toBe("no-store")
    expect((await post(app, "/api/control/connect", { host: "127.0.0.1", port: 10254, game_key: gameKey })).status).toBe(503)
    const weak = createApp({ controlToken: "short-control-token" })
    expect(await (await weak.request(`${origin}/api/control/status`)).json()).toMatchObject({ control_enabled: false })
    expect((await post(weak, "/api/control/connect", { host: "127.0.0.1", port: 10254 })).status).toBe(503)
  })

  it("rejects foreign origins, wrong media types, non-loopback hosts, invalid ports and oversized bodies", async () => {
    const fake = fakeControl()
    const app = createApp({ controlToken: token })
    const valid = { host: "127.0.0.1", port: fake.port, game_key: gameKey }
    for (const foreign of ["https://attacker.example", "http://localhost:10252", "http://127.0.0.1:11111", ""]) {
      expect((await post(app, "/api/control/connect", valid, { Origin: foreign })).status).toBe(403)
    }
    expect((await post(app, "/api/control/connect", valid, { "Content-Type": "text/plain" })).status).toBe(415)
    for (const host of ["localhost", "127.0.0.2", "::1", "169.254.169.254", "example.com"]) {
      expect((await post(app, "/api/control/connect", { ...valid, host })).status).toBe(400)
    }
    for (const port of [0, 65536, -1, "10254", 1.5]) {
      expect((await post(app, "/api/control/connect", { ...valid, port })).status).toBe(400)
    }
    expect((await post(app, "/api/control/connect", { ...valid, game_key: gameKey + "0" })).status).toBe(400)
    expect((await post(app, "/api/control/connect", { ...valid, game_key: null })).status).toBe(400)
    expect((await post(app, "/api/control/connect", { ...valid, extra: true })).status).toBe(400)
    expect((await post(app, "/api/control/connect", { ...valid, padding: "x".repeat(600) })).status).toBe(413)
    expect(fake.calls).toHaveLength(0)
  })

  it("verifies signed identity before sending a bearer token or GameKey", async () => {
    for (const options of [{ badProof: true }, { redirect: true }, { closeIdentity: true }]) {
      const fake = fakeControl(options)
      const app = createApp({ controlToken: token })
      const result = await post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port, game_key: gameKey })
      expect(result.status).toBe(502)
      expect(JSON.stringify(await result.json())).not.toContain(gameKey)
      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0]?.path).toBe("/control/v1/identity")
      expect(fake.calls[0]?.authorization).toBeNull()
      expect(fake.calls[0]?.body).toBe("")
    }
    const genuine = fakeControl()
    const relay = fakeControl({ relayPort: genuine.port })
    const app = createApp({ controlToken: token })
    const relayed = await post(app, "/api/control/connect", { host: "127.0.0.1", port: relay.port, game_key: gameKey })
    expect(relayed.status).toBe(502)
    expect(relay.calls).toHaveLength(1)
    expect(relay.calls[0]?.authorization).toBeNull()
    expect(genuine.calls).toHaveLength(0)
  })

  it("connects, reports sanitized service status, and clears the active key without stopping capture", async () => {
    const fake = fakeControl()
    const app = createApp({ controlToken: token })
    const connected = await post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port, game_key: gameKey })
    expect(connected.status).toBe(202)
    expect(await connected.json()).toEqual({ version: 1, service: "inkscope-control", state: "reachable", target: { host: "127.0.0.1", port: fake.port }, key_state: "pending", key_epoch: 1 })
    expect(connected.headers.get("cache-control")).toBe("no-store")
    expect(fake.calls.map((call) => call.path)).toEqual(["/control/v1/identity", "/control/v1/status", "/control/v1/identity", "/control/v1/connect"])
    expect(fake.calls[0]?.authorization).toBeNull()
    expect(fake.calls[1]?.authorization).toBe(`Bearer ${token}`)
    expect(fake.calls[2]?.authorization).toBeNull()
    expect(fake.calls[3]?.authorization).toBe(`Bearer ${token}`)
    expect(JSON.parse(fake.calls[3]!.body)).toEqual({ game_key: gameKey.toLowerCase() })

    const status = await app.request(`${origin}/api/control/status`)
    expect(await status.json()).toEqual({
      version: 1, service: "inkscope-control", state: "reachable", target: { host: "127.0.0.1", port: fake.port }, control_enabled: true,
      capture: "running", key_state: "pending", key_locked: false, key_source: "control", key_epoch: 1, publisher: { enabled: true, connection: "connected" },
    })
    const sanitized = await app.request(`${origin}/api/control/status`)
    expect(JSON.stringify(await sanitized.json())).not.toContain(gameKey)
    const disconnected = await post(app, "/api/control/disconnect", {})
    expect(disconnected.status).toBe(202)
    expect(await disconnected.json()).toMatchObject({ key_state: "pending", key_epoch: 2 })
    expect(fake.calls.at(-1)?.path).toBe("/control/v1/disconnect")
    expect(fake.calls.at(-1)?.body).toBe("")
    const finalStatus = await app.request(`${origin}/api/control/status`)
    expect(await finalStatus.json()).toMatchObject({ state: "reachable", capture: "running", key_state: "absent", key_epoch: 2 })
    for (const response of [connected, disconnected, status, finalStatus]) {
      expect(response.headers.get("cache-control")).toBe("no-store")
    }
  })

  it("reports a preconfigured key as locked and never forwards the entered GameKey", async () => {
    const fake = fakeControl({ locked: true })
    const app = createApp({ controlToken: token })
    const result = await post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port, game_key: gameKey })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ state: "reachable", key_state: "applied", key_locked: true, key_source: "file" })
    expect(fake.calls.map((call) => call.path)).toEqual(["/control/v1/identity", "/control/v1/status"])
    expect(fake.calls.every((call) => !call.body.includes(gameKey))).toBe(true)
    const status = await app.request(`${origin}/api/control/status`)
    expect(await status.json()).toMatchObject({ state: "reachable", key_state: "applied", key_locked: true, key_source: "file" })
    const disconnected = await post(app, "/api/control/disconnect", {})
    expect(disconnected.status).toBe(409)
    expect(fake.calls.some((call) => call.path === "/control/v1/disconnect")).toBe(false)
  })

  it("discovers an InkScope control target without sending a GameKey", async () => {
    const fake = fakeControl()
    const app = createApp({ controlToken: token })
    const result = await post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ state: "reachable", key_state: "absent", key_locked: false, key_source: "none" })
    expect(fake.calls.map((call) => call.path)).toEqual(["/control/v1/identity", "/control/v1/status"])
    expect(fake.calls.every((call) => !call.body.includes(gameKey))).toBe(true)
    const status = await app.request(`${origin}/api/control/status`)
    expect(await status.json()).toMatchObject({ state: "reachable", target: { host: "127.0.0.1", port: fake.port } })
  })

  it("does not send a GameKey when the mutation pair loses its verified socket", async () => {
    const fake = fakeControl({ closeSecondIdentity: true })
    const app = createApp({ controlToken: token })
    const result = await post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port, game_key: gameKey })
    expect(result.status).toBe(502)
    expect(fake.calls.map((call) => call.path)).toEqual(["/control/v1/identity", "/control/v1/status", "/control/v1/identity"])
    expect(fake.calls.at(-1)?.authorization).toBeNull()
    expect(fake.calls.every((call) => !call.body.includes(gameKey))).toBe(true)
  })

  it("keeps the prior target when a key mutation fails", async () => {
    const prior = fakeControl()
    const rejected = fakeControl({ rejectMutation: true })
    const app = createApp({ controlToken: token })
    expect((await post(app, "/api/control/connect", { host: "127.0.0.1", port: prior.port })).status).toBe(200)
    expect((await post(app, "/api/control/connect", { host: "127.0.0.1", port: rejected.port, game_key: gameKey })).status).toBe(409)
    const status = await app.request(`${origin}/api/control/status`)
    expect(await status.json()).toMatchObject({ state: "reachable", target: { host: "127.0.0.1", port: prior.port } })
  })

  it("rejects disconnect before a target is selected and bounds an unresponsive service", async () => {
    const app = createApp({ controlToken: token })
    expect((await post(app, "/api/control/disconnect", {})).status).toBe(409)
    const fake = fakeControl({ slowIdentity: true })
    const started = Date.now()
    const pending = post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port, game_key: gameKey })
    await Bun.sleep(25)
    expect((await post(app, "/api/control/connect", { host: "127.0.0.1", port: fake.port })).status).toBe(409)
    const response = await pending
    expect(response.status).toBe(504)
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})
