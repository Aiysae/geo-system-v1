export const PENETRATION_AUTOMATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_penetration_automation_schedules_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  billing_user_id TEXT NOT NULL,
  team_id TEXT,
  status TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  time_local TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  start_date TEXT NOT NULL,
  relative_drop_threshold_pct NUMERIC(7,2) NOT NULL DEFAULT 20,
  minimum_absolute_drop_points NUMERIC(7,2) NOT NULL DEFAULT 3,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_credit_limit INTEGER,
  detection_config JSONB,
  next_run_at TIMESTAMPTZ,
  last_scheduled_for TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_execution_id TEXT,
  last_job_id TEXT,
  last_history_record_id TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS geo_penetration_automation_owner_client_unique_idx
  ON geo_penetration_automation_schedules_v1 (owner_user_id, client_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS geo_penetration_automation_due_idx
  ON geo_penetration_automation_schedules_v1 (next_run_at ASC)
  WHERE deleted_at IS NULL AND status = 'active';

ALTER TABLE geo_penetration_automation_schedules_v1
  ADD COLUMN IF NOT EXISTS detection_config JSONB;

CREATE TABLE IF NOT EXISTS geo_penetration_automation_executions_v1 (
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  billing_user_id TEXT NOT NULL,
  team_id TEXT,
  trigger TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  job_id TEXT,
  history_record_id TEXT,
  input_snapshot JSONB,
  estimated_credits INTEGER NOT NULL DEFAULT 0,
  used_credits INTEGER,
  baseline_history_record_id TEXT,
  baseline_rate NUMERIC(12,8),
  current_rate NUMERIC(12,8),
  absolute_drop_points NUMERIC(9,4),
  relative_drop_pct NUMERIC(9,4),
  comparable BOOLEAN,
  comparison_reason TEXT,
  alert_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  alert_sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_user_id, id),
  UNIQUE (owner_user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS geo_penetration_automation_execution_active_idx
  ON geo_penetration_automation_executions_v1 (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'submitted', 'running');

CREATE INDEX IF NOT EXISTS geo_penetration_automation_execution_schedule_idx
  ON geo_penetration_automation_executions_v1 (owner_user_id, schedule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_penetration_automation_execution_client_idx
  ON geo_penetration_automation_executions_v1 (owner_user_id, client_id, created_at DESC);

DO $$
DECLARE
  current_definition TEXT;
BEGIN
  IF to_regclass('geo_user_notifications') IS NOT NULL THEN
    SELECT pg_get_constraintdef(oid)
      INTO current_definition
      FROM pg_constraint
     WHERE conrelid = 'geo_user_notifications'::regclass
       AND conname = 'geo_user_notifications_type_check';

    IF current_definition IS NOT NULL
       AND (
         current_definition NOT LIKE '%penetration_automation_completed%'
         OR current_definition NOT LIKE '%penetration_automation_alert%'
         OR current_definition NOT LIKE '%penetration_automation_attention%'
         OR current_definition NOT LIKE '%feedback_report_sent%'
         OR current_definition NOT LIKE '%feedback_report_attention%'
       ) THEN
      ALTER TABLE geo_user_notifications
        DROP CONSTRAINT geo_user_notifications_type_check;
      ALTER TABLE geo_user_notifications
        ADD CONSTRAINT geo_user_notifications_type_check
        CHECK (type IN (
          'payment_request',
          'payment_request_credited',
          'payment_request_canceled',
          'feedback_action_reminder',
          'penetration_automation_completed',
          'penetration_automation_alert',
          'penetration_automation_attention',
          'feedback_report_sent',
          'feedback_report_attention'
        ));
    END IF;
  END IF;
END $$;
`
