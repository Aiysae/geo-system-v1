import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const apiRoot = join(process.cwd(), "src", "app", "api")

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return entry === "route.ts" ? [path] : []
  })
}

const violations = routeFiles(apiRoot).flatMap(path => {
  const source = readFileSync(path, "utf8")
  const directAdapterCall =
    /ADAPTERS(?:\.[A-Za-z0-9_]+|\[[^\]]+\])\.chat\s*\(/.test(source)
  return directAdapterCall ? [relative(process.cwd(), path)] : []
})

assert.deepEqual(
  violations,
  [],
  `API routes must use the credential pool instead of direct adapters: ${violations.join(", ")}`,
)

console.log("All API routes use pooled model access instead of direct adapter calls")
