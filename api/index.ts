import { websocket } from "@hono/bun"
import { createApp, indexPath, readSampleConfig } from "./app"
import { LiveStore } from "./live-store"
import { openPostgresPersistence } from "./postgres"

if (!(await Bun.file(indexPath).exists())) {
  console.error(`Visualizer build is missing: ${indexPath}. Run \`bun run build\` first.`)
  process.exit(1)
}

const port = Number(process.env.PORT ?? 10252)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT: ${process.env.PORT}`)
  process.exit(1)
}

let sample: ReturnType<typeof readSampleConfig>
try {
  sample = readSampleConfig(process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid recorded sample configuration")
  process.exit(1)
}

let replay: Awaited<ReturnType<typeof openPostgresPersistence>> | undefined
if (process.env.DATABASE_URL) {
  try {
    replay = await openPostgresPersistence(process.env.DATABASE_URL)
  } catch (error) {
    console.error(error instanceof Error ? error.message : "PostgreSQL sidecar setup failed")
    process.exit(1)
  }
}

const store = new LiveStore({ persistence: replay })
if (replay) {
  try {
    store.hydrate(await replay.recent(64))
  } catch {
    console.error("PostgreSQL replay startup readback failed")
    await replay.close()
    process.exit(1)
  }
}
const app = createApp({
  store,
  replay,
  sample,
  ingestToken: process.env.INKSCOPE_VISUALIZER_TOKEN,
  controlToken: process.env.INKSCOPE_CONTROL_TOKEN,
})
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
  websocket,
})

console.log(`InkScope Visualizer: ${server.url}`)
