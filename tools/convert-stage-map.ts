import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const expectedSourceSha256 = "bcd6de03d598b450cd8adaf0c9cfa725b84bb110793e244c4c9536f0c3602334"
const expectedDecompressedSha256 = "3fd608b6eca45b1e65bc824879ce5fcdec3d019abc2a433d7f300bdd673bb757"
const repoRoot = resolve(import.meta.dirname, "..")
const localDir = resolve(repoRoot, "app/public/maps/local")
const outputPath = resolve(localDir, "cop-shakedent.glb")
const markerPath = resolve(repoRoot, "app/public/maps/cop-shakedent-markers.json")

type Primitive = { attributes: Record<string, number>; indices?: number; targets?: Record<string, number>[]; mode?: number }
type Gltf = {
  buffers: { byteLength: number; uri?: string }[]
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[]
  meshes: { primitives: Primitive[] }[]
  nodes: { mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[]
  materials?: { normalTexture?: unknown; extensions?: Record<string, unknown> }[]
}

export function decodeGlb(bytes: Buffer): { json: Gltf; binary: Buffer } {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error("Invalid GLB v2 header")
  }
  const jsonLength = bytes.readUInt32LE(12)
  if (jsonLength % 4 !== 0 || bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length) {
    throw new Error("Invalid GLB JSON chunk")
  }
  const binaryHeader = 20 + jsonLength
  const binaryLength = bytes.readUInt32LE(binaryHeader)
  if (binaryLength % 4 !== 0 || bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942 || binaryHeader + 8 + binaryLength !== bytes.length) {
    throw new Error("Expected one final GLB BIN chunk")
  }
  const json = JSON.parse(bytes.subarray(20, binaryHeader).toString("utf8")) as Gltf
  if (!Array.isArray(json.buffers) || json.buffers.length !== 1 || json.buffers[0]?.uri ||
    json.buffers[0].byteLength > binaryLength || binaryLength - json.buffers[0].byteLength > 3) {
    throw new Error("Invalid embedded GLB buffer length")
  }
  return { json, binary: bytes.subarray(binaryHeader + 8) }
}

function encodeGlb(json: Gltf, binary: Buffer): Buffer {
  const jsonText = Buffer.from(JSON.stringify(json), "utf8")
  const paddedJson = Buffer.concat([jsonText, Buffer.alloc((4 - jsonText.length % 4) % 4, 0x20)])
  const result = Buffer.alloc(12 + 8 + paddedJson.length + 8 + binary.length)
  result.writeUInt32LE(0x46546c67, 0)
  result.writeUInt32LE(2, 4)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(paddedJson.length, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  paddedJson.copy(result, 20)
  result.writeUInt32LE(binary.length, 20 + paddedJson.length)
  result.writeUInt32LE(0x004e4942, 24 + paddedJson.length)
  binary.copy(result, 28 + paddedJson.length)
  return result
}

export function repairPreviewGlb(bytes: Buffer): Buffer {
  const { json, binary } = decodeGlb(bytes)
  if (json.materials?.some((material) => material.normalTexture !== undefined || material.extensions !== undefined)) {
    throw new Error("Model has normal textures or material extensions; cannot discard tangents for the preview")
  }
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      delete primitive.attributes.TANGENT
      delete primitive.attributes.COLOR_0
      for (const target of primitive.targets ?? []) {
        delete target.TANGENT
        delete target.COLOR_0
      }
    }
  }
  const repaired = encodeGlb(json, binary)
  const checked = decodeGlb(repaired)
  if (!checked.binary.equals(binary)) throw new Error("Geometry buffer changed during GLB repair")
  if (checked.json.meshes.some((mesh) => mesh.primitives.some((primitive) =>
    primitive.attributes.TANGENT !== undefined || primitive.attributes.COLOR_0 !== undefined ||
    primitive.targets?.some((target) => target.TANGENT !== undefined || target.COLOR_0 !== undefined)))) {
    throw new Error("Invalid attributes remain after GLB repair")
  }
  return repaired
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function meshStats(bytes: Buffer, markerPoints: number[][]) {
  const { json, binary } = decodeGlb(bytes)
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const nearest = markerPoints.map(() => ({ distance: Infinity, vertex: [0, 0, 0] }))
  let vertices = 0
  let triangles = 0
  const visitedPositions = new Set<number>()
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION]
      if (!accessor || accessor.componentType !== 5126 || accessor.type !== "VEC3" || accessor.sparse || accessor.count < 1) throw new Error("Unsupported POSITION accessor")
      const bufferView = json.bufferViews[accessor.bufferView]
      if (!bufferView || bufferView.buffer !== 0) throw new Error("Invalid POSITION bufferView")
      const accessorOffset = accessor.byteOffset ?? 0
      const start = (bufferView.byteOffset ?? 0) + accessorOffset
      const stride = bufferView.byteStride ?? 12
      const bytesNeeded = accessorOffset + (accessor.count - 1) * stride + 12
      if (stride < 12 || bytesNeeded > bufferView.byteLength ||
        (bufferView.byteOffset ?? 0) + bytesNeeded > json.buffers[0]!.byteLength) {
        throw new Error("POSITION exceeds binary buffer")
      }
      for (let i = 0; i < accessor.count; i++) {
        const vertex = [0, 1, 2].map((axis) => view.getFloat32(start + i * stride + axis * 4, true))
        for (let axis = 0; axis < 3; axis++) {
          const value = vertex[axis]!
          if (!Number.isFinite(value)) throw new Error("Non-finite vertex")
          min[axis] = Math.min(min[axis]!, value)
          max[axis] = Math.max(max[axis]!, value)
        }
        markerPoints.forEach((point, index) => {
          const distance = Math.hypot(vertex[0]! - point[0]!, vertex[1]! - point[1]!, vertex[2]! - point[2]!)
          if (distance < nearest[index]!.distance) nearest[index] = { distance, vertex }
        })
      }
      if (!visitedPositions.has(primitive.attributes.POSITION)) {
        vertices += accessor.count
        visitedPositions.add(primitive.attributes.POSITION)
      }
      if ((primitive.mode ?? 4) === 4) triangles += Math.floor(
        primitive.indices === undefined ? accessor.count / 3 : json.accessors[primitive.indices]!.count / 3,
      )
    }
  }
  const transformedNodes = json.nodes.filter((node) =>
    node.matrix !== undefined && node.matrix.some((value, index) => value !== (index % 5 === 0 ? 1 : 0)) ||
    node.translation !== undefined && node.translation.some((value) => value !== 0) ||
    node.rotation !== undefined && node.rotation.some((value, index) => value !== (index === 3 ? 1 : 0)) ||
    node.scale !== undefined && node.scale.some((value) => value !== 1),
  ).length
  return { meshes: json.meshes.length, vertices, triangles, bounds: { min, max }, transformedNodes, nearest }
}

async function run(command: string[], stdout: "pipe" | ReturnType<typeof Bun.file> = "pipe", cwd?: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout, stderr: "pipe" })
  const [exitCode, output, error] = await Promise.all([
    child.exited,
    stdout === "pipe" ? new Response(child.stdout as ReadableStream<Uint8Array>).text() : Promise.resolve(""),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${command[0]} exited ${exitCode}: ${error || output}`)
  return output.trim()
}

async function main() {
  const [sourceArg, converterArg] = process.argv.slice(2)
  if (!sourceArg || !converterArg || process.argv.length !== 4) {
    throw new Error("Usage: bun tools/convert-stage-map.ts <Fld_Shakedent00.bfres.zs> <wmdlt binary>")
  }
  const source = resolve(sourceArg)
  const converter = resolve(converterArg)
  const sourceBytes = Buffer.from(await readFile(source))
  const converterSha256 = sha256(Buffer.from(await readFile(converter)))
  if (sha256(sourceBytes) !== expectedSourceSha256) throw new Error("BFRES source SHA-256 does not match the owned 11.3.0 asset")
  await mkdir(localDir, { recursive: true })
  if (await realpath(localDir) !== join(await realpath(repoRoot), "app/public/maps/local")) throw new Error("Unsafe output directory")
  try {
    await run(["git", "check-ignore", "-q", outputPath], "pipe", repoRoot)
  } catch {
    throw new Error("Local model path must be ignored by Git")
  }

  const tempDir = await mkdtemp(join(tmpdir(), "inkscope-stage-map-"))
  try {
    const compressed = join(tempDir, "Fld_Shakedent00.bfres.zs")
    const decompressed = join(tempDir, "Fld_Shakedent00.bfres")
    const rawGlb = join(tempDir, "raw.glb")
    await writeFile(compressed, sourceBytes)
    await run(["zstd", "-dc", compressed], Bun.file(decompressed))
    const decompressedBytes = Buffer.from(await readFile(decompressed))
    if (sha256(decompressedBytes) !== expectedDecompressedSha256) throw new Error("Decompressed BFRES SHA-256 mismatch")
    if (decompressedBytes.toString("ascii", 0, 4) !== "FRES") throw new Error("Decompressed source is not BFRES")
    await run([converter, "DECODE", decompressed, "--dest", rawGlb])
    const rawBytes = Buffer.from(await readFile(rawGlb))
    const repaired = repairPreviewGlb(rawBytes)
    const markers = JSON.parse(await readFile(markerPath, "utf8")) as { markers: { actor: string; layer: string; position: number[] }[] }
    const targets = [
      markers.markers.find((point) => point.actor === "CoopIkuraBank" && point.layer === "Cmn"),
      markers.markers.find((point) => point.actor === "CoopIkuraBank" && point.layer === "Low"),
      markers.markers.find((point) => point.actor === "StartPos"),
    ]
    if (targets.some((target) => !target)) throw new Error("Reference Banc markers are missing")
    const stats = meshStats(repaired, targets.map((target) => target!.position))
    if (stats.meshes === 0 || stats.triangles === 0 || stats.transformedNodes !== 0) throw new Error("Unexpected GLB geometry or node transforms")
    const version = await run([converter, "--version"])
    const zstdVersion = await run(["zstd", "--version"])
    if (!version || !zstdVersion) throw new Error("Converter or zstd version was not reported")
    if (sha256(Buffer.from(await readFile(converter))) !== converterSha256) throw new Error("Converter binary changed during extraction")
    const manifest = {
      stageId: "Cop_Shakedent",
      sourceSha256: sha256(sourceBytes),
      decompressedSha256: sha256(decompressedBytes),
      converterVersion: version.split("\n")[0],
      converterSha256,
      zstdVersion: zstdVersion.split("\n")[0],
      rawGlbSha256: sha256(rawBytes),
      previewGlbSha256: sha256(repaired),
      previewGlbBytes: repaired.length,
      ...stats,
      nearestMarkerOrder: ["CoopIkuraBank:Cmn", "CoopIkuraBank:Low", "StartPos:first"],
      note: "Geometry-only local preview; source textures absent; nearest-vertex distances do not prove surface alignment.",
    }
    const pendingGlb = join(localDir, `.cop-shakedent-${randomUUID()}.glb.tmp`)
    const pendingManifest = join(localDir, `.cop-shakedent-${randomUUID()}.json.tmp`)
    try {
      await writeFile(pendingGlb, repaired)
      await writeFile(pendingManifest, JSON.stringify(manifest, null, 2) + "\n")
      await rm(join(localDir, "cop-shakedent.manifest.json"), { force: true })
      await rename(pendingGlb, outputPath)
      await rename(pendingManifest, join(localDir, "cop-shakedent.manifest.json"))
    } finally {
      await rm(pendingGlb, { force: true })
      await rm(pendingManifest, { force: true })
    }
    console.log(JSON.stringify({ outputPath, manifest }, null, 2))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
