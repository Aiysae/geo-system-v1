export const AGENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_agent_tokens_v1 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_mode TEXT NOT NULL DEFAULT 'selected',
  client_grants JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  daily_credit_limit INTEGER NOT NULL DEFAULT 500,
  max_task_credits INTEGER NOT NULL DEFAULT 200,
  allowed_ips JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (client_mode IN ('all', 'selected')),
  CHECK (status IN ('active', 'revoked')),
  CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
  CHECK (daily_credit_limit BETWEEN 0 AND 1000000),
  CHECK (max_task_credits BETWEEN 0 AND 1000000)
);

CREATE INDEX IF NOT EXISTS geo_agent_tokens_v1_owner_idx
  ON geo_agent_tokens_v1 (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_agent_tokens_v1_active_idx
  ON geo_agent_tokens_v1 (status, expires_at);

CREATE TABLE IF NOT EXISTS geo_agent_audit_v1 (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  request_id TEXT,
  client_id TEXT,
  team_id TEXT,
  status TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  estimated_credits INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (status IN ('accepted', 'succeeded', 'failed', 'denied'))
);

CREATE INDEX IF NOT EXISTS geo_agent_audit_v1_owner_created_idx
  ON geo_agent_audit_v1 (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_agent_audit_v1_token_created_idx
  ON geo_agent_audit_v1 (token_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_agent_audit_v1_trace_idx
  ON geo_agent_audit_v1 (trace_id);
`
