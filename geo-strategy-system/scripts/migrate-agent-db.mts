import { Pool } from "pg"
import { AGENT_SCHEMA_SQL } from "../src/lib/agent/schema"

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
})

try {
  await pool.query(AGENT_SCHEMA_SQL)
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'geo_agent_%'
     ORDER BY table_name`,
  )
  console.log(`Agent schema ready: ${result.rows.map(row => row.table_name).join(", ")}`)
} finally {
  await pool.end()
}
