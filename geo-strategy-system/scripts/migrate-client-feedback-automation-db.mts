import { Pool } from "pg"
import { CLIENT_FEEDBACK_AUTOMATION_SCHEMA_SQL } from "../src/lib/client-feedback/automation-schema"

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
})

try {
  await pool.query(CLIENT_FEEDBACK_AUTOMATION_SCHEMA_SQL)
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (
         'geo_client_feedback_automation_schedules_v1',
         'geo_client_feedback_automation_executions_v1'
       )
     ORDER BY table_name`,
  )
  if (result.rows.length !== 2) throw new Error("Client feedback automation schema was not created")
  console.log(`Client feedback automation schema ready: ${result.rows.map(row => row.table_name).join(", ")}`)
} finally {
  await pool.end()
}
