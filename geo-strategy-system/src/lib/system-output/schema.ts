export const SYSTEM_OUTPUT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_system_outputs_v1 (
  owner_user_id TEXT NOT NULL,
  actor_user_id TEXT,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  module TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'job',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_snapshot JSONB,
  result_snapshot JSONB,
  resource_reference JSONB,
  error TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, module, task_id)
);

ALTER TABLE geo_system_outputs_v1
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'job';

CREATE INDEX IF NOT EXISTS geo_system_outputs_owner_completed_idx
  ON geo_system_outputs_v1 (owner_user_id, completed_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS geo_system_outputs_owner_client_completed_idx
  ON geo_system_outputs_v1 (owner_user_id, client_id, completed_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS geo_system_outputs_owner_module_completed_idx
  ON geo_system_outputs_v1 (owner_user_id, module, completed_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;
`
