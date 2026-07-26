import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const { AI_CREDENTIAL_PRESET_BY_VENDOR } = await import(
  "../src/lib/ai-credential-presets"
)

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

for (const vendor of ["doubao", "qwen", "ernie", "hunyuan"] as const) {
  const preset = AI_CREDENTIAL_PRESET_BY_VENDOR.get(vendor)
  assert.ok(preset, `${vendor} must have a credential preset`)
  assert.equal(
    preset.allowedModules.includes("penetration"),
    true,
    `${vendor} verified official-web accounts must be eligible for penetration scheduling`,
  )
  assert.equal(
    preset.declaredCapabilities.includes("native_web")
      && preset.declaredCapabilities.includes("auditable_sources"),
    true,
    `${vendor} strict-web verification must require native web and auditable sources`,
  )
}

console.log("All API routes use pooled model access instead of direct adapter calls")
