export const CLIENT_FEEDBACK_AUTOMATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_client_feedback_automation_schedules_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  team_id TEXT,
  status TEXT NOT NULL,
  weekly_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  time_local TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  period_mode TEXT NOT NULL DEFAULT 'service',
  recipient_emails_ciphertext TEXT NOT NULL,
  send_empty_reports BOOLEAN NOT NULL DEFAULT TRUE,
  final_report_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at TIMESTAMPTZ,
  last_weekly_period_end TEXT,
  last_monthly_period_end TEXT,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_execution_id TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS geo_client_feedback_automation_owner_client_idx
  ON geo_client_feedback_automation_schedules_v1 (owner_user_id, client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS geo_client_feedback_automation_due_idx
  ON geo_client_feedback_automation_schedules_v1 (next_run_at ASC)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE IF NOT EXISTS geo_client_feedback_automation_executions_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  team_id TEXT,
  trigger TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL,
  periods JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  reports JSONB NOT NULL DEFAULT '[]'::jsonb,
  deliveries JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS geo_client_feedback_automation_execution_schedule_idx
  ON geo_client_feedback_automation_executions_v1
  (owner_user_id, schedule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_client_feedback_automation_execution_active_idx
  ON geo_client_feedback_automation_executions_v1
  (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'running', 'generated');
`
