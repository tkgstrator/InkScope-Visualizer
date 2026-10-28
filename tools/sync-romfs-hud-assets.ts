/** Cache selected HUD PNGs decoded from this workstation's owned Splatoon 3 RomFS. */
import { copyFile, mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"

const decodedDir = process.argv[2]
if (!decodedDir) {
  throw new Error("Usage: bun tools/sync-romfs-hud-assets.ts <decoded-png-directory>")
}

const output = resolve(import.meta.dir, "../app/public/local-game-assets")
const textures = [
  ["Coop_MainTV_00.img001.png", "romfs-coop-egg.png", 128, 128],
  ["Coop_MainTV_00.img008.png", "romfs-coop-tape-main.png", 256, 128],
  ["Coop_MainTV_00.img006.png", "romfs-coop-tape-lower.png", 256, 128],
  ["Coop_MainTV_00.img005.png", "romfs-coop-tape-left.png", 256, 128],
  ["Coop_MainTV_00.img009.png", "romfs-coop-tape-main-right.png", 256, 128],
  ["Coop_MainTV_00.img007.png", "romfs-coop-tape-lower-right.png", 256, 128],
  ["TGPlayerIcon_00.img014.png", "romfs-coop-squid.png", 152, 152],
  ["Timer_00.img000.png", "romfs-coop-timer.png", 154, 84],
] as const

const checked = await Promise.all(textures.map(async ([sourceName, destinationName, width, height]) => {
  const source = resolve(decodedDir, sourceName)
  const png = await readFile(source)
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
    throw new Error(`Unexpected texture format: ${sourceName}`)
  }
  return { source, destinationName }
}))

await mkdir(output, { recursive: true })
for (const { source, destinationName } of checked) {
  await copyFile(source, resolve(output, destinationName))
}
console.log(`Cached ${checked.length} local RomFS HUD textures in ${output}`)
