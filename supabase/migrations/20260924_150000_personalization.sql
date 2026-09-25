-- ═══════════════════════════════════════════════════════════════════
-- UNAPPLIED — DO NOT APPLY without explicit owner authorization naming the
-- Sporv Supabase project. Spec 30-PERSONALIZATION §6.1 tables, frontend
-- phase ships the config engine only (browser-local). This file stages the
-- backend shape for the authorized backend phase.
-- ═══════════════════════════════════════════════════════════════════

-- The six templates; parent_id builds the ladder (club ← team_coach, camp).
CREATE TABLE IF NOT EXISTS public.templates (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  parent_id     text REFERENCES public.templates(id),
  version       integer NOT NULL DEFAULT 1,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Which template an org started from (orgs live in the existing schema;
-- this avoids altering core tables).
CREATE TABLE IF NOT EXISTS public.org_template (
  org_id            uuid PRIMARY KEY,
  template_id       text NOT NULL REFERENCES public.templates(id),
  template_version  integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Every config change ever made. version is the optimistic-locking guard:
-- Apply carries base_version; mismatch rejects with a diff (compare-and-swap).
CREATE TABLE IF NOT EXISTS public.workspace_config_versions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL,
  version       integer NOT NULL,
  patch         jsonb NOT NULL DEFAULT '[]'::jsonb,
  full_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_id     uuid,
  source        text NOT NULL CHECK (source IN ('template','chat','settings')),
  request_text  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, version)
);

-- Personal changes affecting one user only (layout, notifications, AI profile).
CREATE TABLE IF NOT EXISTS public.user_overrides (
  user_id       uuid NOT NULL,
  org_id        uuid NOT NULL,
  layout        jsonb NOT NULL DEFAULT '{}'::jsonb,
  notifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_profile    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

-- Every chatbox proposal, applied or not. base_version pins the preview.
CREATE TABLE IF NOT EXISTS public.config_proposals (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL,
  user_id       uuid NOT NULL,
  request_text  text NOT NULL,
  patch         jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary       text,
  scope         text NOT NULL CHECK (scope IN ('just-you','everyone')),
  base_version  integer NOT NULL,
  status        text NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','applied','cancelled','conflicted')),
  errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Plain-English agent rules and their compiled form.
CREATE TABLE IF NOT EXISTS public.agent_rules (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL,
  scope         text NOT NULL DEFAULT 'workspace',
  raw_text      text NOT NULL,
  compiled      jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Workspace-defined custom fields (jersey size, belt rank, ...).
CREATE TABLE IF NOT EXISTS public.custom_field_defs (
  org_id        uuid NOT NULL,
  object        text NOT NULL,
  key           text NOT NULL,
  label         text NOT NULL,
  type          text NOT NULL DEFAULT 'text',
  options       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, object, key)
);

-- Chat requests the system could not fulfil.
CREATE TABLE IF NOT EXISTS public.feature_requests (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid,
  request_text  text NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS on: deny by default until the authorized backend phase writes the
-- org-membership policies. No policies = no access, which is the safe default.
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;

-- Seed the six template rows (config payloads ship with the backend phase).
INSERT INTO public.templates (id, name, parent_id, version, config) VALUES
  ('solo_trainer','Solo Trainer',NULL,1,'{}'),
  ('team_coach','Team Coach','solo_trainer',1,'{}'),
  ('camp','Camp / Clinic','solo_trainer',1,'{}'),
  ('facility','Facility / Gym','solo_trainer',1,'{}'),
  ('club','Club','team_coach',1,'{}'),
  ('enterprise','Enterprise','club',1,'{}')
ON CONFLICT (id) DO NOTHING;
-- NOTE: club's second parent (camp) and enterprise's second parent (facility)
-- are diamond parents; precedence is left-parent-wins per spec §1. A future
-- template_parents join table can model both edges when needed.
