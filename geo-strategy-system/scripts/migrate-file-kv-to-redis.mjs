import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { isDeepStrictEqual } from "node:util"
import { createClient } from "redis"

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function loadState(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("KV source must be a JSON object")
  }
  return parsed
}

function activeEntries(state, now) {
  const entries = []
  let expired = 0
  let emptySets = 0

  for (const [key, entry] of Object.entries(state)) {
    if (!key || !entry || typeof entry !== "object") {
      throw new Error("KV source contains an invalid entry")
    }
    if (entry.expiresAt && Number(entry.expiresAt) <= now) {
      expired += 1
      continue
    }
    if (entry.type !== "value" && entry.type !== "set") {
      throw new Error("KV source contains an unsupported entry type")
    }
    if (entry.type === "set" && !Array.isArray(entry.members)) {
      throw new Error("KV source contains an invalid set")
    }
    if (entry.type === "set" && entry.members.length === 0) {
      emptySets += 1
      continue
    }
    entries.push([key, entry])
  }

  return { entries, expired, emptySets }
}

function encodeValue(value) {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? "null" : encoded
}

function decodeValue(value) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function assertLocalRedisUrl(value) {
  if (!value) throw new Error("REDIS_URL is required")
  const url = new URL(value)
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("Migration target must be a local Redis instance")
  }
}

async function verify(client, entries) {
  let verified = 0
  for (const [key, entry] of entries) {
    if (entry.type === "value") {
      const stored = await client.get(key)
      if (stored === null || !isDeepStrictEqual(decodeValue(stored), entry.value)) {
        throw new Error("Redis value verification failed")
      }
    } else {
      const actual = (await client.sMembers(key)).sort()
      const expected = entry.members.map(String).sort()
      if (!isDeepStrictEqual(actual, expected)) {
        throw new Error("Redis set verification failed")
      }
    }

    const ttl = await client.ttl(key)
    if (entry.expiresAt && ttl <= 0) throw new Error("Redis TTL verification failed")
    if (!entry.expiresAt && ttl !== -1) throw new Error("Unexpected Redis TTL")
    verified += 1
  }
  return verified
}

async function migrate(client, entries, now) {
  let transaction = client.multi()
  let commandCount = 0

  async function flush() {
    if (commandCount === 0) return
    const results = await transaction.exec()
    if (!results || results.length !== commandCount) {
      throw new Error("Redis migration transaction failed")
    }
    transaction = client.multi()
    commandCount = 0
  }

  for (const [key, entry] of entries) {
    const ttlSeconds = entry.expiresAt
      ? Math.max(1, Math.ceil((Number(entry.expiresAt) - now) / 1000))
      : undefined

    if (entry.type === "value") {
      transaction.set(key, encodeValue(entry.value), ttlSeconds
        ? { expiration: { type: "EX", value: ttlSeconds } }
        : undefined)
      commandCount += 1
    } else {
      transaction.sAdd(key, entry.members.map(String))
      commandCount += 1
      if (ttlSeconds) {
        transaction.expire(key, ttlSeconds)
        commandCount += 1
      }
    }

    if (commandCount >= 100) await flush()
  }
  await flush()
}

async function main() {
  const sourcePath = path.resolve(argumentValue("--source", "/var/lib/geo-system/kv.json"))
  const apply = process.argv.includes("--apply")
  const verifyOnly = process.argv.includes("--verify")
  if (apply && verifyOnly) throw new Error("Choose either --apply or --verify")

  const state = loadState(sourcePath)
  const now = Date.now()
  const { entries, expired, emptySets } = activeEntries(state, now)
  const summary = {
    sourceKeys: Object.keys(state).length,
    migratableKeys: entries.length,
    expiredKeysSkipped: expired,
    emptySetsSkipped: emptySets,
    values: entries.filter(([, entry]) => entry.type === "value").length,
    sets: entries.filter(([, entry]) => entry.type === "set").length,
  }

  if (!apply && !verifyOnly) {
    console.log(JSON.stringify({ mode: "dry-run", ...summary }, null, 2))
    return
  }

  if (apply && process.env.MIGRATION_CONFIRM !== "FILE_TO_REDIS") {
    throw new Error("Set MIGRATION_CONFIRM=FILE_TO_REDIS before applying migration")
  }

  const redisUrl = String(process.env.REDIS_URL || "").trim()
  assertLocalRedisUrl(redisUrl)
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 5_000 } })
  client.on("error", () => {})
  await client.connect()

  try {
    const before = await client.dbSize()
    if (apply && before !== 0) {
      throw new Error(`Redis target is not empty (${before} keys)`)
    }
    if (apply) await migrate(client, entries, now)
    const verified = await verify(client, entries)
    const after = await client.dbSize()
    if (after !== entries.length) {
      throw new Error(`Redis key count mismatch: expected ${entries.length}, received ${after}`)
    }
    console.log(JSON.stringify({
      mode: apply ? "apply" : "verify",
      ...summary,
      redisKeysBefore: before,
      redisKeysAfter: after,
      verifiedKeys: verified,
    }, null, 2))
  } finally {
    await client.quit().catch(() => client.destroy())
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "KV migration failed")
  process.exitCode = 1
})
