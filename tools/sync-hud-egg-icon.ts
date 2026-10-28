/** Cache Nintendo's Golden Egg icon for local HUD rendering only. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sourceDir = resolve(process.argv[2] ?? fileURLToPath(new URL("../../thunder_api/docs/mock-diff/assets/img/ui/", import.meta.url)))
const source = resolve(sourceDir, "gold-ikura.svg")
const destinationDir = resolve(import.meta.dir, "../app/public/local-game-assets")

if (!existsSync(source)) {
  throw new Error(`Missing Golden Egg icon in ${sourceDir}. Populate the local thunder_api image cache first.`)
}

mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, resolve(destinationDir, "gold-ikura.svg"))
console.log(`Golden Egg icon cached locally in ${destinationDir}`)
