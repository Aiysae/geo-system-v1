export const WORKSPACE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_workspace_clients (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  core JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS geo_workspace_clients_user_updated_idx
  ON geo_workspace_clients (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS geo_workspace_sections (
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  section TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, client_id, section),
  CONSTRAINT geo_workspace_sections_client_fk
    FOREIGN KEY (user_id, client_id)
    REFERENCES geo_workspace_clients (user_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS geo_workspace_imports (
  user_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicated_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, import_id)
);
`
