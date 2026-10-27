import { describe, expect, test } from "bun:test"
import { decodeGlb, repairPreviewGlb } from "./convert-stage-map"

function syntheticGlb(normalTexture = false): Buffer {
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4 }],
    bufferViews: [{ buffer: 0, byteLength: 4 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TANGENT: 0, COLOR_0: 0 }, targets: [{ TANGENT: 0, COLOR_0: 0 }] }] }],
    nodes: [],
    materials: normalTexture ? [{ normalTexture: { index: 0 } }] : [],
  }
  const text = Buffer.from(JSON.stringify(json), "utf8")
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)])
  const binary = Buffer.from([0x10, 0x20, 0x30, 0x40])
  const out = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length)
  out.writeUInt32LE(0x46546c67, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(padded.length, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  padded.copy(out, 20)
  out.writeUInt32LE(binary.length, 20 + padded.length)
  out.writeUInt32LE(0x004e4942, 24 + padded.length)
  binary.copy(out, 28 + padded.length)
  return out
}

describe("local BFRES preview GLB repair", () => {
  test("removes invalid display attributes without changing the geometry buffer", () => {
    const before = syntheticGlb()
    const after = repairPreviewGlb(before)
    const decoded = decodeGlb(after)
    const primitive = decoded.json.meshes[0]!.primitives[0]!
    expect(primitive.attributes).toEqual({ POSITION: 0 })
    expect(primitive.targets).toEqual([{}])
    expect(decoded.binary).toEqual(decodeGlb(before).binary)
    expect(repairPreviewGlb(after)).toEqual(after)
  })

  test("rejects normal-mapped material before removing tangents", () => {
    expect(() => repairPreviewGlb(syntheticGlb(true))).toThrow("normal textures")
  })

  test("rejects truncated GLB input", () => {
    expect(() => decodeGlb(syntheticGlb().subarray(0, 20))).toThrow("Invalid GLB v2 header")
  })
})
