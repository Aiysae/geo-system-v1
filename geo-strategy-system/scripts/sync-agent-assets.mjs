import fs from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const source = path.join(root, "cli", "shitu-geo.mjs")
const targetDirectory = path.join(root, "public", "downloads")
const target = path.join(targetDirectory, "shitu-geo.mjs")

await fs.mkdir(targetDirectory, { recursive: true })
await fs.copyFile(source, target)
console.log(`Synced ${path.relative(root, target)}`)
