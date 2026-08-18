import { Pool } from "pg"
import { AI_CREDENTIAL_SCHEMA_SQL } from "../src/lib/ai-credential-store"
import { AI_CREDENTIAL_ROUTE_HEALTH_SCHEMA_SQL } from "../src/lib/ai-credential-route-health"

const connectionString = String(process.env.DATABASE_URL || "").trim()
if (!connectionString) throw new Error("DATABASE_URL is required")

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  ssl: /^(1|true|yes|on)$/i.test(String(process.env.DATABASE_SSL || ""))
    ? { rejectUnauthorized: false }
    : undefined,
})

try {
  await pool.query(AI_CREDENTIAL_SCHEMA_SQL)
  await pool.query(AI_CREDENTIAL_ROUTE_HEALTH_SCHEMA_SQL)
  console.log("AI credential and route health database schema is ready")
} finally {
  await pool.end()
}
