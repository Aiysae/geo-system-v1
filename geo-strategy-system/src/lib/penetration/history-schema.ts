export const PENETRATION_HISTORY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_penetration_history_v1 (
  owner_user_id TEXT NOT NULL,
  actor_user_id TEXT,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'job',
  request_snapshot JSONB NOT NULL,
  summary JSONB NOT NULL,
  dashboard_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id)
);

ALTER TABLE geo_penetration_history_v1
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT;

CREATE INDEX IF NOT EXISTS geo_penetration_history_owner_completed_idx
  ON geo_penetration_history_v1 (owner_user_id, completed_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS geo_penetration_history_owner_client_completed_idx
  ON geo_penetration_history_v1 (owner_user_id, client_id, completed_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;
`
