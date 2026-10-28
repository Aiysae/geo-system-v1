import assert from "node:assert/strict"
import { createRequire } from "node:module"
import type * as PostgresJsonModule from "../src/lib/postgres-json"

const require = createRequire(import.meta.url)
const { postgresJson } = require("../src/lib/postgres-json.ts") as typeof PostgresJsonModule

// A 300-character cut that lands inside 🚇 leaves its high half behind.
const cut = "营业时间:24小时 🚇交通攻略:地铁🚇".slice(0, -1)
assert.ok(cut.endsWith("\ud83d"))
assert.ok(JSON.stringify(cut).includes("\\ud83d"))

const json = postgresJson({ snippet: cut, sources: [{ title: "\udc87开头" }], ok: "完整的🚇", count: 3 })
assert.ok(!/\\ud[89a-f]/i.test(json), "no escaped lone surrogates are left for Postgres to reject")
assert.deepEqual(JSON.parse(json), {
  snippet: "营业时间:24小时 🚇交通攻略:地铁",
  sources: [{ title: "开头" }],
  ok: "完整的🚇",
  count: 3,
})
assert.equal(postgresJson(null), "null")

console.log("postgres json ok")
