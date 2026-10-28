/// <reference types="bun" />
import { describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import { app, createApp, distDir, localTerrainPath, readSampleConfig } from "./app"
import type { PostgresPersistence } from "./postgres"
import type { PacketEnvelope } from "./wire"
import fixture from "./fixtures/packet-v1.json"

describe("Hono visualizer server", () => {
  it("validates the optional local recorded sample selector", () => {
    const sessionId = fixture.session_id
    expect(readSampleConfig({})).toBeUndefined()
    expect(readSampleConfig({ INKSCOPE_SAMPLE_SESSION_ID: sessionId, INKSCOPE_SAMPLE_AFTER_RECORD: "28832" }))
      .toEqual({ sessionId, afterRecord: "28832" })
    for (const env of [
      { INKSCOPE_SAMPLE_SESSION_ID: sessionId },
      { INKSCOPE_SAMPLE_AFTER_RECORD: "0" },
      { INKSCOPE_SAMPLE_SESSION_ID: "invalid", INKSCOPE_SAMPLE_AFTER_RECORD: "0" },
      { INKSCOPE_SAMPLE_SESSION_ID: sessionId, INKSCOPE_SAMPLE_AFTER_RECORD: "18446744073709551616" },
    ]) expect(() => readSampleConfig(env)).toThrow("Invalid recorded sample configuration")
  })

  it("serves a configured bounded local sample without caching", async () => {
    const calls: Array<[string, string | null, number]> = []
    const countCalls: Array<[string, string]> = []
    const replay = { countEventsThrough: async (sessionId: string, afterRecord: string) => {
      countCalls.push([sessionId, afterRecord])
      return 42
    }, readEvents: async (sessionId: string, afterRecord: string | null, limit: number) => {
      calls.push([sessionId, afterRecord, limit])
      return [fixture as PacketEnvelope]
    } } as PostgresPersistence
    const sampleApp = createApp({ replay, sample: { sessionId: fixture.session_id, afterRecord: "0" } })
    const response = await sampleApp.request("http://127.0.0.1:10252/api/sample")
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ version: 1, state: "ready", session_id: fixture.session_id, after_record: "0", start_index: 42, events: [fixture] })
    expect(calls).toEqual([[fixture.session_id, "0", 32]])
    expect(countCalls).toEqual([[fixture.session_id, "0"]])
  })

  it("distinguishes missing, empty, and failed local samples", async () => {
    const missing = await app.request("http://127.0.0.1:10252/api/sample")
    expect(missing.status).toBe(200)
    expect(missing.headers.get("cache-control")).toBe("private, no-store")
    expect(await missing.json()).toEqual({ version: 1, state: "unavailable" })

    const sample = { sessionId: fixture.session_id, afterRecord: "0" }
    const missingStorage = await createApp({ sample }).request("http://127.0.0.1:10252/api/sample")
    expect(missingStorage.status).toBe(503)
    expect(missingStorage.headers.get("cache-control")).toBe("private, no-store")
    expect(await missingStorage.json()).toEqual({ error: "Recorded sample storage unavailable" })

    const emptyApp = createApp({ replay: { readEvents: async () => [] } as unknown as PostgresPersistence, sample })
    const empty = await emptyApp.request("http://127.0.0.1:10252/api/sample")
    expect(empty.headers.get("cache-control")).toBe("private, no-store")
    expect(await empty.json()).toEqual({ version: 1, state: "empty", session_id: fixture.session_id, after_record: "0" })

    const failedApp = createApp({ replay: { readEvents: async () => { throw Error("private database detail") } } as unknown as PostgresPersistence, sample })
    const failed = await failedApp.request("http://127.0.0.1:10252/api/sample")
    expect(failed.status).toBe(503)
    expect(failed.headers.get("cache-control")).toBe("private, no-store")
    expect(await failed.json()).toEqual({ error: "Recorded sample read failed" })
  })

  it("bounds a large sample response to 8 MiB without skipping records", async () => {
    const payloadHex = "ab".repeat(55_000)
    const events = Array.from({ length: 100 }, (_, index) => ({
      ...fixture,
      record: String(index + 1),
      packet: { ...fixture.packet, payload_hex: payloadHex },
    })) as PacketEnvelope[]
    const calls: Array<[string | null, number]> = []
    const sampleApp = createApp({
      replay: { readEvents: async (_: string, after: string | null, limit: number) => {
        calls.push([after, limit])
        return events.filter((event) => BigInt(event.record) > BigInt(after ?? "0")).slice(0, limit)
      }, countEventsThrough: async () => 0 } as unknown as PostgresPersistence,
      sample: { sessionId: fixture.session_id, afterRecord: "0" },
    })
    const response = await sampleApp.request("http://127.0.0.1:10252/api/sample")
    const raw = await response.text()
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
    const body = JSON.parse(raw) as { events: PacketEnvelope[] }
    expect(body.events.length).toBeGreaterThan(0)
    expect(body.events.length).toBeLessThan(100)
    expect(body.events.map((event) => event.record)).toEqual(events.slice(0, body.events.length).map((event) => event.record))
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.every(([, limit]) => limit <= 32)).toBe(true)
  })

  it("walks multiple bounded batches through an exact contiguous sample", async () => {
    const events = Array.from({ length: 70 }, (_, index) => ({ ...fixture, record: String(index + 1) })) as PacketEnvelope[]
    const calls: Array<[string | null, number]> = []
    const sampleApp = createApp({
      replay: { readEvents: async (_: string, after: string | null, limit: number) => {
        calls.push([after, limit])
        return events.filter((event) => BigInt(event.record) > BigInt(after ?? "0")).slice(0, limit)
      }, countEventsThrough: async () => 0 } as unknown as PostgresPersistence,
      sample: { sessionId: fixture.session_id, afterRecord: "0" },
    })
    const response = await sampleApp.request("http://127.0.0.1:10252/api/sample")
    expect(response.status).toBe(200)
    const body = await response.json() as { start_index: number; events: PacketEnvelope[] }
    expect(body.start_index).toBe(0)
    expect(body.events.map((event) => event.record)).toEqual(events.map((event) => event.record))
    expect(calls).toEqual([["0", 32], ["32", 32], ["64", 32]])
  })

  it("stops a small-event sample at 1200 records", async () => {
    const events = Array.from({ length: 1201 }, (_, index) => ({ ...fixture, record: String(index + 1) })) as PacketEnvelope[]
    const calls: Array<[string | null, number]> = []
    const sampleApp = createApp({
      replay: { readEvents: async (_: string, after: string | null, limit: number) => {
        calls.push([after, limit])
        return events.filter((event) => BigInt(event.record) > BigInt(after ?? "0")).slice(0, limit)
      }, countEventsThrough: async () => 0 } as unknown as PostgresPersistence,
      sample: { sessionId: fixture.session_id, afterRecord: "0" },
    })
    const response = await sampleApp.request("http://127.0.0.1:10252/api/sample")
    const body = await response.json() as { events: PacketEnvelope[] }
    expect(body.events).toHaveLength(1200)
    expect(body.events[0]?.record).toBe("1")
    expect(body.events.at(-1)?.record).toBe("1200")
    expect(calls[0]).toEqual(["0", 32])
    expect(calls.at(-1)).toEqual(["1184", 16])
  })

  it("includes a requested older saved session outside the latest 100", async () => {
    const other = { session_id: "e61c1c49-4dae-4c6f-aa41-4f7f2a44411e", events: "1", first_timestamp_ns: "1", last_timestamp_ns: "1" }
    const selected = { ...other, session_id: fixture.session_id, events: "39913" }
    const calls: string[] = []
    const replay = {
      listSessions: async () => [other],
      sessionSummary: async (id: string) => { calls.push(id); return selected },
    } as unknown as PostgresPersistence
    const sessionsApp = createApp({ replay })
    const url = `http://127.0.0.1:10252/api/sessions?include_session_id=${fixture.session_id}`
    const response = await sessionsApp.request(url)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: 1, sessions: [other, selected] })
    expect(calls).toEqual([fixture.session_id])

    const duplicateApp = createApp({ replay: { listSessions: async () => [selected], sessionSummary: async () => { throw Error("unneeded query") } } as unknown as PostgresPersistence })
    expect(await (await duplicateApp.request(url)).json()).toEqual({ version: 1, sessions: [selected] })
    for (const query of ["include_session_id=invalid", "include_session_id=", `include_session_id=${fixture.session_id}&include_session_id=${fixture.session_id}`]) {
      const invalid = await sessionsApp.request(`http://127.0.0.1:10252/api/sessions?${query}`)
      expect(invalid.status).toBe(400)
    }
  })

  it("serves the built app and OBS query as HTML", async () => {
    for (const path of ["/", "/?view=overlay", "/session/example"]) {
      const response = await app.request(`http://localhost:10252${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(response.headers.get("cache-control")).toBe("no-cache")
      expect(await response.text()).toContain('id="root"')
    }
  })

  it("serves built assets and RomFS-derived marker data", async () => {
    const asset = (await readdir(`${distDir}/assets`)).find((name) => name.endsWith(".js"))
    expect(asset).toBeDefined()
    const script = await app.request(`http://localhost:10252/assets/${asset}`)
    expect(script.status).toBe(200)
    expect(script.headers.get("content-type")).toContain("javascript")
    expect(script.headers.get("cache-control")).toContain("immutable")

    const data = await app.request("http://localhost:10252/maps/cop-shakedent-markers.json")
    expect(data.status).toBe(200)
    const markers = await data.json() as { stageId: string; markers: unknown[] }
    expect(markers.stageId).toBe("Cop_Shakedent")
    expect(markers.markers).toHaveLength(39)

    const anchorResponse = await app.request("http://localhost:10252/maps/cop-shakedent-enemy-anchors.json")
    expect(anchorResponse.status).toBe(200)
    const anchors = await anchorResponse.json() as { stageId: string; markers: unknown[] }
    expect(anchors.stageId).toBe("Cop_Shakedent")
    expect(anchors.markers).toHaveLength(76)
  })

  it("does not hide missing assets or API paths behind the app shell", async () => {
    for (const path of ["/assets/missing.js", "/api/missing", "/package.json", "/..%2fvite.config.ts", "/maps/local/missing.glb"]) {
      const response = await app.request(`http://localhost:10252${path}`)
      expect(response.status).toBe(404)
    }
    const post = await app.request("http://localhost:10252/", { method: "POST" })
    expect(post.status).toBe(404)
  })

  it("serves owned terrain outside the build output when locally installed", async () => {
    if (!(await Bun.file(localTerrainPath).exists())) return
    const response = await app.request("http://localhost:10252/maps/local/cop-shakedent.glb", { method: "HEAD" })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("model/gltf-binary")
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(1_000_000)
    expect(await Bun.file(`${distDir}/maps/local/cop-shakedent.glb`).exists()).toBe(false)
  })

  it("keeps replay routes explicit when PostgreSQL is not configured", async () => {
    const response = await app.request("http://127.0.0.1:10252/api/sessions")
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "Replay storage unavailable in memory mode" })
    const status = await app.request("http://127.0.0.1:10252/api/status")
    expect(await status.json()).toMatchObject({ mode: "memory", ingest_enabled: false })
    const ingest = await app.request("http://127.0.0.1:10252/api/ingest")
    expect(ingest.status).toBe(503)
  })

  it("rejects non-local and mismatched Host values before API reads", async () => {
    for (const url of ["http://attacker.example:10252/api/status", "http://192.0.2.1:10252/api/control/status"]) {
      expect((await app.request(url)).status).toBe(403)
    }
    const mismatch = await app.request("http://127.0.0.1:10252/api/status", { headers: { Host: "attacker.example:10252" } })
    expect(mismatch.status).toBe(403)
    const control = await app.request("http://localhost:10252/api/control/status", { headers: { Host: "localhost:10252" } })
    expect(control.status).toBe(200)
  })

  it("serves only the allowlisted local stage models", async () => {
    const missing = await app.request("http://127.0.0.1:10252/maps/local/cop-shakehighway.glb")
    expect([200, 404]).toContain(missing.status)
    const unknown = await app.request("http://127.0.0.1:10252/maps/local/cop-unknown.glb")
    expect(unknown.status).toBe(404)
    const nonModel = await app.request("http://127.0.0.1:10252/maps/local/cop-shakedent.manifest.json")
    expect(nonModel.status).toBe(404)
  })
})
