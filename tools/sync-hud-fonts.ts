/** Copy game UI fonts from an existing local thunder_api cache for this workstation only. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const source = resolve(process.argv[2] ?? fileURLToPath(new URL("../../thunder_api/docs/mock-diff/assets/fonts/", import.meta.url)))
const destination = resolve(import.meta.dir, "../app/public/local-fonts")
const fonts = [
  ["Splatoon2-common.4e7b2cad208fa2fc42ca.woff2", "splatoon2-common.woff2"],
  ["Splatoon1-common.3b7ce8b3c19f74921f51.woff2", "splatoon1-common.woff2"],
] as const

for (const [filename] of fonts) {
  if (!existsSync(resolve(source, filename))) {
    throw new Error(`Missing ${filename} in ${source}. Populate the local thunder_api font cache first.`)
  }
}

mkdirSync(destination, { recursive: true })
for (const [filename, localName] of fonts) {
  copyFileSync(resolve(source, filename), resolve(destination, localName))
}

console.log(`HUD fonts cached locally in ${destination}`)
