export const TEAM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS geo_teams_v1 (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS geo_teams_v1_owner_active_idx
  ON geo_teams_v1 (owner_user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS geo_team_members_v1 (
  team_id TEXT NOT NULL REFERENCES geo_teams_v1(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  permission_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  invited_by_user_id TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id),
  CHECK (role IN ('owner', 'admin', 'member')),
  CHECK (status IN ('active', 'suspended'))
);

CREATE INDEX IF NOT EXISTS geo_team_members_v1_user_idx
  ON geo_team_members_v1 (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS geo_team_invites_v1 (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES geo_teams_v1(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  permission_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT,
  CHECK (role IN ('admin', 'member')),
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
);

CREATE INDEX IF NOT EXISTS geo_team_invites_v1_team_idx
  ON geo_team_invites_v1 (team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS geo_team_invites_v1_email_idx
  ON geo_team_invites_v1 (email, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS geo_team_client_shares_v1 (
  team_id TEXT NOT NULL REFERENCES geo_teams_v1(id) ON DELETE CASCADE,
  client_owner_user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  member_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (team_id, client_owner_user_id, client_id),
  CHECK (scope IN ('all', 'selected'))
);

CREATE INDEX IF NOT EXISTS geo_team_client_shares_v1_client_idx
  ON geo_team_client_shares_v1 (client_id, team_id);

CREATE TABLE IF NOT EXISTS geo_team_audit_v1 (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES geo_teams_v1(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  client_owner_user_id TEXT,
  client_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS geo_team_audit_v1_team_created_idx
  ON geo_team_audit_v1 (team_id, created_at DESC);
`
