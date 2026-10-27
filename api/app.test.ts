/// <reference types="bun" />
import { describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import { app, distDir, localTerrainPath } from "./app"

describe("Hono visualizer server", () => {
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
