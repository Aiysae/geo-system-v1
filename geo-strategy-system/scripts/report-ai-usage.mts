import { Pool } from "pg"

const days = Math.min(90, Math.max(1, Math.floor(Number(process.argv[2]) || 7)))
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
const db = new Pool({
  connectionString: process.env.DATABASE_URL, max: 1,
  ssl: /^(1|true|yes|on)$/i.test(process.env.DATABASE_SSL || "")
    ? { rejectUnauthorized: false } : undefined,
})
try {
  await db.query("BEGIN READ ONLY")
  await db.query("SET LOCAL statement_timeout = '15s'")
  const result = await db.query(`
    SELECT (u.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
      u.task, u.provider_key, u.model_id, COALESCE(c.account_label, 'unattributed') AS account,
      COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE u.success)::int AS successful_calls,
      COUNT(*) FILTER (WHERE u.usage_reported IS TRUE)::int AS reported_usage_calls,
      COUNT(*) FILTER (WHERE u.usage_reported IS NOT TRUE)::int AS unknown_usage_calls,
      SUM(u.prompt_tokens)::bigint AS reported_input_tokens,
      SUM(u.completion_tokens)::bigint AS reported_output_tokens,
      SUM(u.cached_prompt_tokens)::bigint AS reported_cached_input_tokens,
      SUM(u.reasoning_tokens)::bigint AS reported_reasoning_tokens,
      ROUND(AVG(u.latency_ms)) AS average_latency_ms
    FROM geo_ai_usage_v1 u LEFT JOIN geo_ai_credentials_v1 c ON c.id = u.credential_id
    WHERE u.created_at >= NOW() - ($1::int * INTERVAL '1 day')
    GROUP BY 1, 2, 3, 4, 5 ORDER BY 1 DESC, reported_output_tokens DESC
  `, [days])
  await db.query("COMMIT")
  console.log(JSON.stringify({
    days, timezone: "Asia/Shanghai",
    note: "Unknown usage is not free usage. Reasoning tokens are included in output; cached tokens are included in input. Search fees and provider invoices are not reconciled here. Compare identical tasks and coverage.",
    rows: result.rows,
  }, null, 2))
} finally {
  await db.end()
}
