import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { connect as netConnect, type Socket } from "node:net"
import type { Hono } from "hono"

const service = "inkscope-control"
const responseLimit = 4_096
const requestLimit = 512
const timeoutMs = 1_500
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Target = { host: "127.0.0.1"; port: number; instanceId: string }
type ControlFailureKind = "timeout" | "unreachable" | "untrusted" | "conflict"

class ControlFailure extends Error {
  constructor(readonly kind: ControlFailureKind) {
    super(kind)
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function sameOrigin(origin: string | undefined, url: string): boolean {
  if (!origin) return false
  try {
    const requestUrl = new URL(url)
    const browserOrigin = new URL(origin)
    return requestUrl.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(requestUrl.hostname)
      && browserOrigin.origin === origin
      && browserOrigin.origin === requestUrl.origin
  } catch {
    return false
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length")
  if (declared !== null && Number(declared) > requestLimit) throw new Error("too_large")
  const reader = request.body?.getReader()
  if (!reader) throw new Error("invalid_json")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > requestLimit) throw new Error("too_large")
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw new Error("invalid_json")
  }
}

async function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    // A single numeric loopback socket carries identity and the sensitive
    // request. It never uses DNS, an environment proxy, or redirects.
    const socket = netConnect({ host: "127.0.0.1", port })
    socket.setNoDelay(true)
    const timer = setTimeout(() => {
      reject(new ControlFailure("timeout"))
      socket.destroy()
    }, timeoutMs)
    const onConnectError = () => {
      clearTimeout(timer)
      reject(new ControlFailure("unreachable"))
    }
    socket.once("connect", () => {
      clearTimeout(timer)
      socket.off("error", onConnectError)
      resolve(socket)
    })
    socket.once("error", onConnectError)
    // A failure between the two framed requests should be observed through
    // socket.destroyed, without becoming an unhandled process exception.
    socket.on("error", () => undefined)
  })
}

async function requestJson(
  socket: Socket,
  port: number,
  path: string,
  method: "GET" | "POST",
  keepAlive: boolean,
  token?: string,
  body?: string,
): Promise<{ status: number; value: unknown; connection: string }> {
  if (socket.destroyed) throw new ControlFailure("untrusted")
  const headers = [
    `${method} ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Accept: application/json",
    `Connection: ${keepAlive ? "keep-alive" : "close"}`,
  ]
  if (token) headers.push(`Authorization: Bearer ${token}`)
  if (method === "POST") {
    if (body !== undefined) headers.push("Content-Type: application/json")
    headers.push(`Content-Length: ${Buffer.byteLength(body ?? "")}`)
  }
  const request = `${headers.join("\r\n")}\r\n\r\n${body ?? ""}`
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0)
    let headerEnd = -1
    let bodyLength = -1
    let status = 0
    let contentType = ""
    let connection = ""
    const cleanup = () => {
      clearTimeout(timer)
      socket.off("data", onData)
      socket.off("error", onError)
      socket.off("close", onClose)
    }
    const fail = (kind: ControlFailureKind) => {
      cleanup()
      reject(new ControlFailure(kind))
    }
    const onError = () => fail("unreachable")
    const onClose = () => fail("untrusted")
    const onData = (chunk: Buffer) => {
      response = Buffer.concat([response, chunk])
      if (response.byteLength > responseLimit * 2) return fail("untrusted")
      if (headerEnd < 0) {
        headerEnd = response.indexOf("\r\n\r\n")
        if (headerEnd < 0) {
          if (response.byteLength > responseLimit) fail("untrusted")
          return
        }
        if (headerEnd > responseLimit) return fail("untrusted")
        const lines = response.subarray(0, headerEnd).toString("utf8").split("\r\n")
        const match = /^HTTP\/1\.[01] ([0-9]{3})(?: |$)/.exec(lines.shift() ?? "")
        if (!match) return fail("untrusted")
        status = Number(match[1])
        const fields = new Map<string, string>()
        for (const line of lines) {
          const separator = line.indexOf(":")
          if (separator < 1) return fail("untrusted")
          const name = line.slice(0, separator).toLowerCase()
          if (fields.has(name)) return fail("untrusted")
          fields.set(name, line.slice(separator + 1).trim())
        }
        const rawLength = fields.get("content-length")
        if (!rawLength || !/^(0|[1-9][0-9]*)$/.test(rawLength) || fields.has("transfer-encoding")) return fail("untrusted")
        bodyLength = Number(rawLength)
        if (!Number.isSafeInteger(bodyLength) || bodyLength > responseLimit) return fail("untrusted")
        contentType = fields.get("content-type")?.toLowerCase() ?? ""
        connection = fields.get("connection")?.toLowerCase() ?? ""
        headerEnd += 4
      }
      const expectedLength = headerEnd + bodyLength
      if (response.byteLength < expectedLength) return
      if (response.byteLength !== expectedLength || !contentType.startsWith("application/json")) return fail("untrusted")
      cleanup()
      if (status === 409) return reject(new ControlFailure("conflict"))
      if (status < 200 || status >= 300) return reject(new ControlFailure(status === 401 || status === 403 ? "untrusted" : "unreachable"))
      try {
        resolve({ status, value: JSON.parse(response.subarray(headerEnd).toString("utf8")), connection })
      } catch {
        reject(new ControlFailure("untrusted"))
      }
    }
    const timer = setTimeout(() => {
      fail("timeout")
      socket.destroy()
    }, timeoutMs)
    socket.on("data", onData)
    socket.on("error", onError)
    socket.on("close", onClose)
    socket.write(request)
  })
}

type VerifiedSession = {
  instanceId: string
  request(path: string, method: "GET" | "POST", body?: string): Promise<{ status: number; value: unknown }>
  close(): void
}

async function openVerifiedSession(port: number, token: string, expectedInstance?: string): Promise<VerifiedSession> {
  const socket = await openSocket(port)
  const nonce = randomBytes(16).toString("hex")
  try {
    const { status, value, connection } = await requestJson(socket, port, `/control/v1/identity?nonce=${nonce}`, "GET", true)
    if (status !== 200 || connection !== "keep-alive" || !record(value) || value.version !== 1 || value.service !== service
      || value.host !== "127.0.0.1" || value.port !== port
      || value.nonce !== nonce || typeof value.instance_id !== "string" || !uuidPattern.test(value.instance_id)
      || typeof value.proof !== "string" || !/^[0-9a-f]{64}$/.test(value.proof)
      || expectedInstance !== undefined && value.instance_id !== expectedInstance) {
      throw new ControlFailure("untrusted")
    }
    const expected = createHmac("sha256", token)
      .update(`inkscope-control/v1\n${nonce}\n${value.instance_id}\n127.0.0.1:${port}`, "utf8")
      .digest()
    if (!timingSafeEqual(expected, Buffer.from(value.proof, "hex"))) throw new ControlFailure("untrusted")
    return {
      instanceId: value.instance_id,
      async request(path, method, body) {
        const result = await requestJson(socket, port, path, method, false, token, body)
        return { status: result.status, value: result.value }
      },
      close: () => socket.destroy(),
    }
  } catch (error) {
    socket.destroy()
    throw error
  }
}

type ServiceStatus = {
  capture: "starting" | "running"
  key_state: "absent" | "pending" | "applied"
  key_locked: boolean
  key_source: "none" | "control" | "cli" | "file" | "elf" | "random_table"
  key_epoch: number
  publisher: { enabled: boolean; connection: "disabled" | "idle" | "connecting" | "connected" | "degraded" }
}

function parseStatus(value: unknown): ServiceStatus {
  if (!record(value) || value.version !== 1 || value.service !== service
    || !["starting", "running"].includes(String(value.capture))
    || !["absent", "pending", "applied"].includes(String(value.key_state))
    || typeof value.key_locked !== "boolean"
    || !["none", "control", "cli", "file", "elf", "random_table"].includes(String(value.key_source))
    || !Number.isSafeInteger(value.key_epoch) || Number(value.key_epoch) < 0
    || !record(value.publisher) || typeof value.publisher.enabled !== "boolean"
    || !["disabled", "idle", "connecting", "connected", "degraded"].includes(String(value.publisher.connection))) {
    throw new ControlFailure("untrusted")
  }
  return {
    capture: value.capture as ServiceStatus["capture"],
    key_state: value.key_state as ServiceStatus["key_state"],
    key_locked: value.key_locked as boolean,
    key_source: value.key_source as ServiceStatus["key_source"],
    key_epoch: value.key_epoch as number,
    publisher: {
      enabled: value.publisher.enabled,
      connection: value.publisher.connection as ServiceStatus["publisher"]["connection"],
    },
  }
}

function parseMutation(value: unknown): { key_state: "pending"; key_epoch: number } {
  if (!record(value) || value.version !== 1 || value.service !== service || value.key_state !== "pending"
    || !Number.isSafeInteger(value.key_epoch) || Number(value.key_epoch) < 0) {
    throw new ControlFailure("untrusted")
  }
  return { key_state: "pending", key_epoch: value.key_epoch as number }
}

function errorStatus(error: unknown): number {
  if (error instanceof ControlFailure && error.kind === "conflict") return 409
  return error instanceof ControlFailure && error.kind === "timeout" ? 504 : 502
}

function publicStatus(selected: Target, current: ServiceStatus) {
  return {
    version: 1,
    service,
    state: "reachable",
    target: { host: selected.host, port: selected.port },
    control_enabled: true,
    ...current,
  }
}

export function registerControlRoutes(app: Hono, token: string | null | undefined): void {
  let target: Target | null = null
  let mutationBusy = false
  const configuredToken = token && /^[\x21-\x7e]{32,}$/.test(token) ? token : null

  app.use("/api/control/*", async (context, next) => {
    context.header("Cache-Control", "no-store")
    context.header("Referrer-Policy", "no-referrer")
    await next()
  })

  app.get("/api/control/status", async (context) => {
    if (!target) return context.json({ version: 1, state: "unconfigured", target: null, control_enabled: Boolean(configuredToken) })
    const selected = target
    const publicTarget = { host: selected.host, port: selected.port }
    if (!configuredToken) return context.json({ version: 1, state: "unreachable", target: publicTarget, control_enabled: false })
    try {
      const session = await openVerifiedSession(selected.port, configuredToken, selected.instanceId)
      let status: number
      let value: unknown
      try {
        ({ status, value } = await session.request("/control/v1/status", "GET"))
      } finally {
        session.close()
      }
      if (status !== 200) throw new ControlFailure("untrusted")
      return context.json(publicStatus(selected, parseStatus(value)))
    } catch (error) {
      return context.json({ version: 1, state: error instanceof ControlFailure && error.kind === "untrusted" ? "untrusted" : "unreachable", target: publicTarget, control_enabled: true })
    }
  })

  for (const action of ["connect", "disconnect"] as const) {
    app.post(`/api/control/${action}`, async (context) => {
      if (!sameOrigin(context.req.header("origin"), context.req.url)) return context.json({ error: "Forbidden origin" }, 403)
      if (context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return context.json({ error: "JSON content type required" }, 415)
      }
      if (!configuredToken) return context.json({ error: "InkScope control is disabled" }, 503)
      let input: unknown
      try {
        input = await readJsonBody(context.req.raw)
      } catch (error) {
        if (error instanceof Error && error.message === "too_large") return context.json({ error: "Request too large" }, 413)
        return context.json({ error: "Invalid JSON" }, 400)
      }
      if (!record(input)) return context.json({ error: "Invalid control request" }, 400)
      if (mutationBusy) return context.json({ error: "InkScope control is busy" }, 409)
      let selected: Target
      let hasKey = false
      if (action === "connect") {
        hasKey = Object.hasOwn(input, "game_key")
        if (!exactKeys(input, hasKey ? ["host", "port", "game_key"] : ["host", "port"]) || input.host !== "127.0.0.1"
          || !Number.isInteger(input.port) || Number(input.port) < 1 || Number(input.port) > 65535
          || hasKey && (typeof input.game_key !== "string" || !/^[0-9a-fA-F]{32}$/.test(input.game_key))) {
          return context.json({ error: "Invalid control request" }, 400)
        }
        selected = { host: "127.0.0.1", port: input.port as number, instanceId: "" }
      } else {
        if (!exactKeys(input, [])) return context.json({ error: "Invalid control request" }, 400)
        if (!target) return context.json({ error: "No InkScope control target" }, 409)
        selected = target
      }
      mutationBusy = true
      try {
        const preflight = await openVerifiedSession(selected.port, configuredToken, action === "disconnect" ? selected.instanceId : undefined)
        let currentResponse: { status: number; value: unknown }
        try {
          currentResponse = await preflight.request("/control/v1/status", "GET")
        } finally {
          preflight.close()
        }
        if (currentResponse.status !== 200) throw new ControlFailure("untrusted")
        const current = parseStatus(currentResponse.value)
        if (action === "connect" && (!hasKey || current.key_locked)) {
          target = { ...selected, instanceId: preflight.instanceId }
          return context.json(publicStatus(selected, current))
        }
        if (current.key_locked) return context.json({ error: "InkScope key is locked", key_locked: true, key_source: current.key_source }, 409)
        const body = action === "connect" ? JSON.stringify({ game_key: (input.game_key as string).toLowerCase() }) : undefined
        const mutationSession = await openVerifiedSession(selected.port, configuredToken, preflight.instanceId)
        let status: number
        let value: unknown
        try {
          ({ status, value } = await mutationSession.request(`/control/v1/${action}`, "POST", body))
        } finally {
          mutationSession.close()
        }
        if (status !== 202) throw new ControlFailure("untrusted")
        const mutation = parseMutation(value)
        if (action === "connect") target = { ...selected, instanceId: mutationSession.instanceId }
        return context.json({ version: 1, service, state: "reachable", target: { host: selected.host, port: selected.port }, ...mutation }, 202)
      } catch (error) {
        if (errorStatus(error) === 409) return context.json({ error: "InkScope control is locked or not running" }, 409)
        if (errorStatus(error) === 504) return context.json({ error: "InkScope control timed out" }, 504)
        return context.json({ error: "InkScope control unavailable or untrusted" }, 502)
      } finally {
        mutationBusy = false
      }
    })
  }
}
