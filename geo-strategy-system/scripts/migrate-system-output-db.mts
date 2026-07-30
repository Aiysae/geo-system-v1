import { Pool } from "pg"
import { SYSTEM_OUTPUT_SCHEMA_SQL } from "../src/lib/system-output/schema"

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
})

try {
  await pool.query(SYSTEM_OUTPUT_SCHEMA_SQL)
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'geo_system_outputs_v1'`,
  )
  if (result.rows.length !== 1) throw new Error("System output schema was not created")
  console.log("System output schema ready: geo_system_outputs_v1")
} finally {
  await pool.end()
}
