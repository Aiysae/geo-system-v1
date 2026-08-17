export const PUBLISHING_PLAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_publishing_plans_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  input JSONB NOT NULL,
  calculation JSONB NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendation_model TEXT,
  recommendation_generated_at TIMESTAMPTZ,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, client_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS geo_publishing_plans_v1_active_idx
  ON geo_publishing_plans_v1 (owner_user_id, client_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS geo_publishing_plans_v1_client_idx
  ON geo_publishing_plans_v1 (owner_user_id, client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS geo_publishing_assets_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('article', 'authority_article', 'video')),
  planned_date DATE NOT NULL,
  title TEXT,
  question_id TEXT,
  question TEXT,
  matched_advantage TEXT,
  prompt_key TEXT,
  generation_job_id TEXT,
  generated_article_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'generating', 'ready', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (owner_user_id, plan_id)
    REFERENCES geo_publishing_plans_v1 (owner_user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS geo_publishing_assets_v1_plan_idx
  ON geo_publishing_assets_v1 (owner_user_id, plan_id, planned_date, id);

CREATE TABLE IF NOT EXISTS geo_publishing_tasks_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  planned_date DATE NOT NULL,
  platform_key TEXT NOT NULL,
  platform_name TEXT NOT NULL,
  account_slot INTEGER NOT NULL CHECK (account_slot > 0),
  status TEXT NOT NULL CHECK (status IN ('planned', 'claimed', 'completed', 'failed', 'skipped')),
  planned_cost_cents INTEGER NOT NULL CHECK (planned_cost_cents >= 0),
  title TEXT,
  published_url TEXT,
  published_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  claimed_by TEXT,
  claim_token TEXT,
  claim_expires_at TIMESTAMPTZ,
  failure_reason TEXT,
  execution_action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (owner_user_id, plan_id)
    REFERENCES geo_publishing_plans_v1 (owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, asset_id)
    REFERENCES geo_publishing_assets_v1 (owner_user_id, id) ON DELETE CASCADE,
  UNIQUE (owner_user_id, plan_id, asset_id, platform_key)
);
CREATE INDEX IF NOT EXISTS geo_publishing_tasks_v1_client_date_idx
  ON geo_publishing_tasks_v1 (owner_user_id, client_id, planned_date, status);
CREATE INDEX IF NOT EXISTS geo_publishing_tasks_v1_claim_idx
  ON geo_publishing_tasks_v1 (owner_user_id, plan_id, status, claim_expires_at, planned_date);
`
