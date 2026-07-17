import { Pool } from "pg"
import { PENETRATION_HISTORY_SCHEMA_SQL } from "../src/lib/penetration/history-schema"

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
})

try {
  await pool.query(PENETRATION_HISTORY_SCHEMA_SQL)
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'geo_penetration_history_v1'`,
  )
  if (result.rows.length !== 1) throw new Error("Penetration history schema was not created")
  console.log("Penetration history schema ready: geo_penetration_history_v1")
} finally {
  await pool.end()
}
