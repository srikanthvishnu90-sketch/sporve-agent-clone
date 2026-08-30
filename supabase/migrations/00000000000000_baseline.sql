-- ============================================================================
-- SPORVE PRODUCTION BASELINE — public schema
-- Project: tseszaprvtvqrkfpditu   Captured: 2026-08-29
--
-- G1 gate artifact: production is reconstructable from this file.
-- Generated via the Supabase connection using Postgres' own DDL renderers
-- (pg_get_functiondef, pg_get_constraintdef, pg_get_indexdef, pg_get_viewdef,
-- pg_get_triggerdef, pg_policies, aclexplode) — not pg_dump. Contents verified
-- object-by-object against the live catalog: 50 tables, 2 sequences,
-- 160 pk/unique/check constraints, 84 foreign keys, 95 functions, 10 views,
-- 41 triggers + 1 event trigger, 90 indexes, RLS on all 50 tables,
-- 134 policies, explicit table/column/function grants, 1 realtime table.
-- Cron jobs are recorded (commented) at the end; vault secrets, storage
-- buckets, and the auth schema are NOT in scope of a public-schema baseline.
-- NOTE: table ACLs use PG17 MAINTAIN; target PG17+ when re-applying.
-- ============================================================================

SET check_function_bodies = off;

-- ------------------------------------------------------------ extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------ sequences
CREATE SEQUENCE IF NOT EXISTS public.cron_http_audit_id_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807;
CREATE SEQUENCE IF NOT EXISTS public.waitlist_position_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807;

-- ------------------------------------------------------------ tables (50)
CREATE TABLE IF NOT EXISTS public.ai_alert_thresholds (
  metric text NOT NULL,
  window_minutes integer NOT NULL,
  warning_threshold numeric NOT NULL,
  critical_threshold numeric NOT NULL,
  min_sample_size integer DEFAULT 0 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  description text NOT NULL,
  updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ai_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  feature text NOT NULL,
  model text NOT NULL,
  actor_id uuid,
  actor_role text,
  input_summary text,
  output_summary text,
  tokens_in integer DEFAULT 0 NOT NULL,
  tokens_out integer DEFAULT 0 NOT NULL,
  est_cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
  approved_by uuid,
  latency_ms integer
);
CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  actor_hash text NOT NULL,
  feature text NOT NULL,
  feature_version text NOT NULL,
  category text NOT NULL,
  helpfulness text NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.ai_observability_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  request_id uuid NOT NULL,
  audit_id text,
  occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  function_name text NOT NULL,
  feature text DEFAULT 'unknown'::text NOT NULL,
  event_type text NOT NULL,
  outcome text NOT NULL,
  provider text,
  http_status integer,
  provider_status integer,
  latency_ms bigint,
  tokens_in bigint DEFAULT 0 NOT NULL,
  tokens_out bigint DEFAULT 0 NOT NULL,
  est_cost_usd numeric(14,6) DEFAULT 0 NOT NULL,
  fallback_used boolean DEFAULT false NOT NULL,
  grounding_status text DEFAULT 'not_applicable'::text NOT NULL,
  error_code text
);
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  used_at timestamp with time zone DEFAULT now() NOT NULL,
  kind text DEFAULT 'command_bar'::text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.athlete_goals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  athlete_id uuid NOT NULL,
  created_by uuid NOT NULL,
  outcome_text text NOT NULL,
  outcome_type text NOT NULL,
  sport text NOT NULL,
  target_date date,
  budget_monthly_cents integer,
  constraints jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  headline text
);
CREATE TABLE IF NOT EXISTS public.athletes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  parent_id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text,
  date_of_birth date,
  gender text,
  preferred_sports text[] DEFAULT '{}'::text[] NOT NULL,
  medical_conditions text,
  emergency_contact jsonb,
  profile_image text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  parent_consent boolean DEFAULT false NOT NULL,
  consent_at timestamp with time zone,
  consent_version text,
  skill_level text
);
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  stripe_subscription_id text NOT NULL,
  stripe_price_id text NOT NULL,
  status text NOT NULL,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  coupon text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  searcher_id uuid NOT NULL,
  session_id uuid NOT NULL,
  athlete_id uuid,
  program_id uuid,
  athlete_first_name text,
  athlete_age_band text,
  selected_tier text,
  original_price numeric(10,2) DEFAULT 0 NOT NULL,
  final_price numeric(10,2) DEFAULT 0 NOT NULL,
  currency text DEFAULT 'USD'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  payment_status text DEFAULT 'unpaid'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  stripe_checkout_session_id text,
  assigned_member_id uuid,
  plan_proposal_id uuid,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  cancellation_reason text,
  cancellation_policy_snapshot text,
  refund_amount numeric(10,2) DEFAULT 0 NOT NULL,
  refunded_at timestamp with time zone,
  stripe_payment_intent_id text,
  provider_responded_at timestamp with time zone,
  platform_fee numeric(10,2),
  platform_fee_bps integer,
  provider_payout numeric(10,2),
  fee_recorded_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.coach_agent_turns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  coach_id uuid NOT NULL,
  org_id uuid,
  input_text text,
  image_present boolean DEFAULT false NOT NULL,
  tool_calls jsonb DEFAULT '[]'::jsonb NOT NULL,
  outcome text DEFAULT 'proposed'::text NOT NULL,
  confidence numeric,
  latency_ms integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.coach_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  inviter_owner_id uuid,
  invited_email text,
  invited_phone text,
  token text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  redeemed_by uuid,
  redeemed_at timestamp with time zone,
  fee_waived boolean DEFAULT true NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  searcher_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  program_id uuid,
  last_message text,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.cron_http_audit (
  id bigint DEFAULT nextval('cron_http_audit_id_seq'::regclass) NOT NULL,
  job_name text NOT NULL,
  request_id bigint NOT NULL,
  queued_at timestamp with time zone DEFAULT now() NOT NULL,
  status_code integer,
  checked_at timestamp with time zone,
  error_msg text
);
CREATE TABLE IF NOT EXISTS public.development_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  goal_id uuid NOT NULL,
  title text NOT NULL,
  phases jsonb DEFAULT '[]'::jsonb NOT NULL,
  current_phase_index integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  concierge_note text,
  concierge_checked_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  booking_id uuid NOT NULL,
  opener_id uuid NOT NULL,
  opener_role text NOT NULL,
  type text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  resolution text DEFAULT 'none'::text NOT NULL,
  resolution_amount numeric(10,2) DEFAULT 0 NOT NULL,
  desired_outcome text,
  detail text NOT NULL,
  proposed_session_id uuid,
  decided_by uuid,
  resolution_note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  actor_key text NOT NULL,
  scope text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  request_count integer DEFAULT 1 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.facilities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  place_id text,
  name text NOT NULL,
  neighborhood text,
  city text,
  latitude double precision,
  longitude double precision,
  court_types text[] DEFAULT '{}'::text[] NOT NULL,
  hours jsonb,
  rental_contact text,
  known_hourly_rate numeric(8,2),
  added_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.facility_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  facility_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  note text NOT NULL,
  rental_status text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.lifecycle_message_prefs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  event_type text NOT NULL,
  mode text DEFAULT 'draft'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.market_overrides (
  sport text NOT NULL,
  metro text NOT NULL,
  force_ready boolean DEFAULT false NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.market_readiness_config (
  id boolean DEFAULT true NOT NULL,
  min_active_listings integer DEFAULT 15 NOT NULL,
  min_review_signals integer DEFAULT 30 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  title text,
  message text,
  read boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  trainer_profile jsonb DEFAULT '{}'::jsonb NOT NULL,
  member_user_id uuid,
  role text DEFAULT 'trainer'::text NOT NULL,
  background_check_status text DEFAULT 'none'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  commission_type text DEFAULT 'percent'::text NOT NULL,
  commission_value numeric DEFAULT 0 NOT NULL,
  background_check_completed_at timestamp with time zone,
  background_check_reference text
);
CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  child_id uuid,
  booking_id uuid,
  event_type text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  scheduled_for timestamp with time zone,
  content jsonb,
  approved_by uuid,
  approved_at timestamp with time zone,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.parent_updates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  session_note_id uuid,
  booking_id uuid,
  provider_id uuid NOT NULL,
  child_id uuid,
  summary_body text,
  skills_worked text[] DEFAULT '{}'::text[] NOT NULL,
  progress_signal text,
  practice_suggestions text[] DEFAULT '{}'::text[] NOT NULL,
  encouragement text,
  status text DEFAULT 'draft'::text NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  sent_at timestamp with time zone,
  delivery_channel text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.payment_event_ledger (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  stripe_event_id text NOT NULL,
  event_type text NOT NULL,
  booking_id uuid,
  stripe_object_id text,
  amount_minor bigint,
  currency text,
  payload_sha256 text,
  outcome text NOT NULL,
  occurred_at timestamp with time zone,
  processed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  plan text NOT NULL,
  ai_monthly_quota integer,
  seat_limit integer,
  workspace_enabled boolean DEFAULT false NOT NULL,
  purchasable boolean DEFAULT false NOT NULL,
  price_usd_month numeric(6,2),
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.plan_proposals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plan_id uuid NOT NULL,
  proposal_type text NOT NULL,
  service_id uuid,
  provider_id uuid,
  reason_text text NOT NULL,
  rank integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'proposed'::text NOT NULL,
  resulting_booking_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  responded_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  requester_id uuid NOT NULL,
  request_type text NOT NULL,
  status text DEFAULT 'submitted'::text NOT NULL,
  scope text DEFAULT 'account'::text NOT NULL,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  resolution_note text
);
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  role text NOT NULL,
  first_name text NOT NULL,
  last_name text,
  email text,
  phone_number text,
  preferred_sports text[] DEFAULT '{}'::text[] NOT NULL,
  profile_image text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.program_fixtures (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  program_id uuid NOT NULL,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone,
  kind text DEFAULT 'game'::text NOT NULL,
  opponent text,
  location text,
  home_away text,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.program_waitlist (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  program_id uuid NOT NULL,
  provider_id uuid,
  searcher_id uuid NOT NULL,
  athlete_id uuid,
  athlete_first_name text,
  athlete_age_band text,
  note text,
  status text DEFAULT 'waiting'::text NOT NULL,
  offered_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.programs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  sport_type text NOT NULL,
  skill_level text,
  age_group text,
  language text DEFAULT 'English'::text NOT NULL,
  cover_image text,
  gallery text[] DEFAULT '{}'::text[] NOT NULL,
  whats_included text[] DEFAULT '{}'::text[] NOT NULL,
  price numeric(10,2) DEFAULT 0 NOT NULL,
  currency text DEFAULT 'USD'::text NOT NULL,
  pricing_model text DEFAULT 'single_session'::text NOT NULL,
  max_capacity integer DEFAULT 0 NOT NULL,
  enrolled_count integer DEFAULT 0 NOT NULL,
  latitude double precision,
  longitude double precision,
  address_line1 text,
  city text,
  state text,
  zip text,
  country text,
  cancellation_policy text DEFAULT 'flexible'::text NOT NULL,
  minimum_age integer,
  maximum_age integer,
  is_featured boolean DEFAULT false NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  average_rating numeric(2,1) DEFAULT 0 NOT NULL,
  total_reviews integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  embedding vector(1536),
  embedding_updated_at timestamp with time zone,
  embedding_source_hash text,
  intensity_tier integer,
  typical_client jsonb,
  session_types text[] DEFAULT '{}'::text[] NOT NULL,
  program_type text DEFAULT 'Training'::text NOT NULL,
  assigned_member_id uuid
);
CREATE TABLE IF NOT EXISTS public.progress_digest_sources (
  digest_id uuid NOT NULL,
  session_note_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.progress_digests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  plan_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  body text NOT NULL,
  sessions_counted integer DEFAULT 0 NOT NULL,
  sources jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.providers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_id uuid NOT NULL,
  business_name text NOT NULL,
  bio text,
  sports text[] DEFAULT '{}'::text[] NOT NULL,
  location text,
  latitude double precision,
  longitude double precision,
  status text DEFAULT 'pending'::text NOT NULL,
  onboarding_completed boolean DEFAULT false NOT NULL,
  verification_status text DEFAULT 'unverified'::text NOT NULL,
  stripe_account_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  stripe_charges_enabled boolean DEFAULT false NOT NULL,
  background_check_status text DEFAULT 'none'::text NOT NULL,
  account_status text DEFAULT 'active'::text NOT NULL,
  coach_years_coaching integer,
  coach_years_played integer,
  credentials text[] DEFAULT '{}'::text[] NOT NULL,
  provider_type text DEFAULT 'solo'::text NOT NULL,
  background_check_completed_at timestamp with time zone,
  public_latitude double precision,
  public_longitude double precision,
  cancellation_policy text,
  what_to_bring text,
  travel_radius text,
  session_notes text,
  faq jsonb DEFAULT '[]'::jsonb NOT NULL,
  buffer_minutes integer DEFAULT 0 NOT NULL,
  vacation_until date,
  verified_at timestamp with time zone,
  payout_enabled_at timestamp with time zone,
  first_booking_at timestamp with time zone,
  last_active_at timestamp with time zone,
  instant_book_enabled boolean DEFAULT false NOT NULL,
  avatar_url text,
  logo_url text,
  stripe_customer_id text,
  plan text DEFAULT 'free'::text NOT NULL,
  plan_status text DEFAULT 'none'::text NOT NULL,
  plan_period_end timestamp with time zone,
  founding_coach boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  booking_id uuid NOT NULL,
  requester_id uuid NOT NULL,
  reason text NOT NULL,
  requested_amount numeric(10,2),
  status text DEFAULT 'submitted'::text NOT NULL,
  stripe_refund_id text,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_at timestamp with time zone,
  completed_at timestamp with time zone,
  decision_note text
);
CREATE TABLE IF NOT EXISTS public.review_windows (
  booking_id uuid NOT NULL,
  opened_at timestamp with time zone DEFAULT now() NOT NULL,
  closes_at timestamp with time zone DEFAULT (now() + '14 days'::interval) NOT NULL,
  released_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  program_id uuid NOT NULL,
  author_id uuid,
  rating integer NOT NULL,
  body text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  booking_id uuid,
  author_role text,
  reviewee_id uuid,
  published_at timestamp with time zone,
  response_body text,
  response_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.safety_reports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  reporter_id uuid NOT NULL,
  provider_id uuid,
  booking_id uuid,
  conversation_id uuid,
  category text NOT NULL,
  details text NOT NULL,
  status text DEFAULT 'submitted'::text NOT NULL,
  priority text DEFAULT 'untriaged'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  acknowledged_at timestamp with time zone,
  resolved_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.search_parse_cache (
  query_hash text NOT NULL,
  query text NOT NULL,
  location_hint jsonb,
  result jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.session_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  booking_id uuid,
  provider_id uuid NOT NULL,
  child_id uuid,
  raw_notes text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  focus_areas text[] DEFAULT '{}'::text[] NOT NULL,
  effort integer,
  progress_note text
);
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  program_id uuid NOT NULL,
  title text,
  start_date date NOT NULL,
  end_date date,
  start_time text,
  end_time text,
  timezone text,
  address text,
  capacity integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  assigned_member_id uuid
);
CREATE TABLE IF NOT EXISTS public.staff_certifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  kind text NOT NULL,
  status text DEFAULT 'none'::text NOT NULL,
  issued_at date,
  expires_at date,
  reference text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.team_athletes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  team_id uuid NOT NULL,
  athlete_id uuid NOT NULL,
  jersey_number text,
  is_available boolean DEFAULT true NOT NULL,
  is_paid boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  provider_id uuid NOT NULL,
  name text NOT NULL,
  sport text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  name text,
  zip text,
  role text NOT NULL,
  sports text[] DEFAULT '{}'::text[],
  referred_by text,
  ref_code text DEFAULT encode(gen_random_bytes(6), 'hex'::text) NOT NULL,
  source text,
  "position" bigint DEFAULT nextval('waitlist_position_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.waitlist_rate_limit (
  ip text NOT NULL,
  ts timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.webhook_dead_letter (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  stripe_event_id text,
  event_type text,
  payload_sha256 text,
  error_msg text,
  occurred_at timestamp with time zone,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  seen_count integer DEFAULT 1 NOT NULL,
  resolved_at timestamp with time zone
);

-- ------------------------------------------------------------ primary keys
ALTER TABLE public.ai_alert_thresholds ADD CONSTRAINT ai_alert_thresholds_pkey PRIMARY KEY (metric);
ALTER TABLE public.ai_audit_log ADD CONSTRAINT ai_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_pkey PRIMARY KEY (id);
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_pkey PRIMARY KEY (id);
ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);
ALTER TABLE public.athlete_goals ADD CONSTRAINT athlete_goals_pkey PRIMARY KEY (id);
ALTER TABLE public.athletes ADD CONSTRAINT athletes_pkey PRIMARY KEY (id);
ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_agent_turns ADD CONSTRAINT coach_agent_turns_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_pkey PRIMARY KEY (id);
ALTER TABLE public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.cron_http_audit ADD CONSTRAINT cron_http_audit_pkey PRIMARY KEY (id);
ALTER TABLE public.development_plans ADD CONSTRAINT development_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.disputes ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);
ALTER TABLE public.edge_rate_limits ADD CONSTRAINT edge_rate_limits_pkey PRIMARY KEY (actor_key, scope, window_start);
ALTER TABLE public.facilities ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);
ALTER TABLE public.facility_notes ADD CONSTRAINT facility_notes_pkey PRIMARY KEY (id);
ALTER TABLE public.lifecycle_message_prefs ADD CONSTRAINT lifecycle_message_prefs_pkey PRIMARY KEY (id);
ALTER TABLE public.market_overrides ADD CONSTRAINT market_overrides_pkey PRIMARY KEY (sport, metro);
ALTER TABLE public.market_readiness_config ADD CONSTRAINT market_readiness_config_pkey PRIMARY KEY (id);
ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_pkey PRIMARY KEY (id);
ALTER TABLE public.payment_event_ledger ADD CONSTRAINT payment_event_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.plan_entitlements ADD CONSTRAINT plan_entitlements_pkey PRIMARY KEY (plan);
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_pkey PRIMARY KEY (id);
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.program_fixtures ADD CONSTRAINT program_fixtures_pkey PRIMARY KEY (id);
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_pkey PRIMARY KEY (id);
ALTER TABLE public.programs ADD CONSTRAINT programs_pkey PRIMARY KEY (id);
ALTER TABLE public.progress_digest_sources ADD CONSTRAINT progress_digest_sources_pkey PRIMARY KEY (digest_id, session_note_id);
ALTER TABLE public.progress_digests ADD CONSTRAINT progress_digests_pkey PRIMARY KEY (id);
ALTER TABLE public.providers ADD CONSTRAINT providers_pkey PRIMARY KEY (id);
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.review_windows ADD CONSTRAINT review_windows_pkey PRIMARY KEY (booking_id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.search_parse_cache ADD CONSTRAINT search_parse_cache_pkey PRIMARY KEY (query_hash);
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_pkey PRIMARY KEY (id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.staff_certifications ADD CONSTRAINT staff_certifications_pkey PRIMARY KEY (id);
ALTER TABLE public.team_athletes ADD CONSTRAINT team_athletes_pkey PRIMARY KEY (id);
ALTER TABLE public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);
ALTER TABLE public.webhook_dead_letter ADD CONSTRAINT webhook_dead_letter_pkey PRIMARY KEY (id);

-- ------------------------------------------------------------ unique constraints
ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_token_key UNIQUE (token);
ALTER TABLE public.facilities ADD CONSTRAINT facilities_place_id_key UNIQUE (place_id);
ALTER TABLE public.lifecycle_message_prefs ADD CONSTRAINT lifecycle_message_prefs_provider_id_event_type_key UNIQUE (provider_id, event_type);
ALTER TABLE public.payment_event_ledger ADD CONSTRAINT payment_event_ledger_stripe_event_id_key UNIQUE (stripe_event_id);
ALTER TABLE public.providers ADD CONSTRAINT providers_owner_id_key UNIQUE (owner_id);
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_stripe_refund_id_key UNIQUE (stripe_refund_id);
ALTER TABLE public.team_athletes ADD CONSTRAINT team_athletes_team_id_athlete_id_key UNIQUE (team_id, athlete_id);
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_ref_code_key UNIQUE (ref_code);

-- ------------------------------------------------------------ check constraints
ALTER TABLE public.ai_alert_thresholds ADD CONSTRAINT ai_alert_thresholds_description_check CHECK (((char_length(description) >= 1) AND (char_length(description) <= 500)));
ALTER TABLE public.ai_alert_thresholds ADD CONSTRAINT ai_alert_thresholds_metric_check CHECK ((metric ~ '^[a-z0-9][a-z0-9_]{0,63}$'::text));
ALTER TABLE public.ai_alert_thresholds ADD CONSTRAINT ai_alert_thresholds_order_check CHECK (((warning_threshold >= (0)::numeric) AND (critical_threshold >= warning_threshold)));
ALTER TABLE public.ai_alert_thresholds ADD CONSTRAINT ai_alert_thresholds_sample_check CHECK (((min_sample_size >= 0) AND (min_sample_size <= 1000000)));
ALTER TABLE public.ai_alert_thresholds ADD CONSTRAINT ai_alert_thresholds_window_check CHECK (((window_minutes >= 1) AND (window_minutes <= 10080)));
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_actor_hash_check CHECK ((actor_hash ~ '^[0-9a-f]{64}$'::text));
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_category_check CHECK ((category = ANY (ARRAY['accuracy'::text, 'relevance'::text, 'stale_listing'::text, 'safety'::text, 'technical'::text, 'other'::text])));
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_comment_check CHECK (((comment IS NULL) OR (char_length(comment) <= 500)));
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_feature_check CHECK ((feature = ANY (ARRAY['coach_discovery'::text, 'coach_matching'::text, 'natural_language_search'::text, 'parent_update_draft'::text, 'message_draft'::text, 'draft_approvals'::text])));
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_feature_version_check CHECK ((((length(feature_version) >= 1) AND (length(feature_version) <= 32)) AND (feature_version ~ '^[A-Za-z0-9._-]+$'::text)));
ALTER TABLE public.ai_feedback ADD CONSTRAINT ai_feedback_helpfulness_check CHECK ((helpfulness = ANY (ARRAY['yes'::text, 'partly'::text, 'no'::text])));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_audit_id_check CHECK (((audit_id IS NULL) OR ((char_length(audit_id) >= 1) AND (char_length(audit_id) <= 128))));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_cost_check CHECK (((est_cost_usd >= (0)::numeric) AND (est_cost_usd <= (100000)::numeric)));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_error_code_check CHECK (((error_code IS NULL) OR (error_code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text)));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_event_type_check CHECK ((event_type = ANY (ARRAY['request_completed'::text, 'provider_call'::text, 'quota_denied'::text])));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_feature_check CHECK ((feature ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_function_name_check CHECK ((function_name ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_grounding_check CHECK ((grounding_status = ANY (ARRAY['not_applicable'::text, 'verified'::text, 'no_candidates'::text, 'unavailable'::text, 'invalid_selection'::text])));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_http_status_check CHECK (((http_status IS NULL) OR ((http_status >= 100) AND (http_status <= 599))));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_latency_check CHECK (((latency_ms IS NULL) OR ((latency_ms >= 0) AND (latency_ms <= 600000))));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'error'::text, 'timeout'::text, 'denied'::text])));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_provider_check CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['anthropic'::text, 'openai'::text]))));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_provider_status_check CHECK (((provider_status IS NULL) OR ((provider_status >= 100) AND (provider_status <= 599))));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_request_id_check CHECK (((request_id)::text <> '00000000-0000-0000-0000-000000000000'::text));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_tokens_in_check CHECK (((tokens_in >= 0) AND (tokens_in <= 1000000000)));
ALTER TABLE public.ai_observability_events ADD CONSTRAINT ai_observability_events_tokens_out_check CHECK (((tokens_out >= 0) AND (tokens_out <= 1000000000)));
ALTER TABLE public.athlete_goals ADD CONSTRAINT athlete_goals_budget_monthly_cents_check CHECK (((budget_monthly_cents IS NULL) OR (budget_monthly_cents >= 0)));
ALTER TABLE public.athlete_goals ADD CONSTRAINT athlete_goals_outcome_type_check CHECK ((outcome_type = ANY (ARRAY['make_team'::text, 'skill_development'::text, 'fitness_fun'::text, 'elite_pathway'::text, 'other'::text])));
ALTER TABLE public.athlete_goals ADD CONSTRAINT athlete_goals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'achieved'::text, 'paused'::text, 'archived'::text])));
ALTER TABLE public.athletes ADD CONSTRAINT athletes_consent_required CHECK (((parent_consent = true) AND (consent_at IS NOT NULL) AND (consent_version IS NOT NULL) AND (char_length(TRIM(BOTH FROM consent_version)) > 0))) NOT VALID;
ALTER TABLE public.athletes ADD CONSTRAINT athletes_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'prefer_not_to_say'::text])));
ALTER TABLE public.athletes ADD CONSTRAINT athletes_skill_level_check CHECK (((skill_level IS NULL) OR (skill_level = ANY (ARRAY['beginner'::text, 'developing'::text, 'intermediate'::text, 'advanced'::text]))));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancellation_reason_length CHECK (((cancellation_reason IS NULL) OR (char_length(cancellation_reason) <= 1000)));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_check CHECK (((refund_amount >= (0)::numeric) AND (refund_amount <= final_price)));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_final_price_check CHECK ((final_price >= (0)::numeric));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_original_price_check CHECK ((original_price >= (0)::numeric));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'partially_refunded'::text, 'refunded'::text, 'failed'::text])));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'declined'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text, 'expired'::text])));
ALTER TABLE public.coach_agent_turns ADD CONSTRAINT coach_agent_turns_outcome_check CHECK ((outcome = ANY (ARRAY['read'::text, 'proposed'::text, 'approved'::text, 'edited'::text, 'cancelled'::text])));
ALTER TABLE public.coach_agent_turns ADD CONSTRAINT coach_agent_turns_tool_calls_is_array CHECK ((jsonb_typeof(tool_calls) = 'array'::text));
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_contact_present CHECK ((COALESCE(NULLIF(TRIM(BOTH FROM invited_email), ''::text), NULLIF(TRIM(BOTH FROM invited_phone), ''::text)) IS NOT NULL));
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])));
ALTER TABLE public.conversations ADD CONSTRAINT conversations_check CHECK ((searcher_id <> provider_id));
ALTER TABLE public.development_plans ADD CONSTRAINT development_plans_current_phase_index_check CHECK ((current_phase_index >= 0));
ALTER TABLE public.development_plans ADD CONSTRAINT development_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text, 'abandoned'::text])));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_desired_outcome_check CHECK (((desired_outcome IS NULL) OR (char_length(desired_outcome) <= 2000)));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_detail_check CHECK (((char_length(TRIM(BOTH FROM detail)) >= 10) AND (char_length(TRIM(BOTH FROM detail)) <= 4000)));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_opener_role_check CHECK ((opener_role = ANY (ARRAY['searcher'::text, 'provider'::text])));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_resolution_amount_check CHECK ((resolution_amount >= (0)::numeric));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_resolution_check CHECK ((resolution = ANY (ARRAY['none'::text, 'refund'::text, 'partial_refund'::text, 'credit'::text, 'reschedule_agreed'::text, 'no_action'::text])));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_resolution_note_check CHECK (((resolution_note IS NULL) OR (char_length(resolution_note) <= 2000)));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'awaiting_counterparty'::text, 'under_review'::text, 'resolved'::text, 'rejected'::text, 'withdrawn'::text])));
ALTER TABLE public.disputes ADD CONSTRAINT disputes_type_check CHECK ((type = ANY (ARRAY['no_show'::text, 'quality'::text, 'reschedule'::text])));
ALTER TABLE public.edge_rate_limits ADD CONSTRAINT edge_rate_limits_request_count_check CHECK ((request_count > 0));
ALTER TABLE public.facility_notes ADD CONSTRAINT facility_notes_rental_status_check CHECK ((rental_status = ANY (ARRAY['inquired'::text, 'confirmed'::text, 'paid_external'::text])));
ALTER TABLE public.lifecycle_message_prefs ADD CONSTRAINT lifecycle_message_prefs_event_type_check CHECK ((event_type = ANY (ARRAY['booking_confirmed'::text, 'reminder_24h'::text, 'post_session'::text, 'no_show_followup'::text, 'rebook_nudge'::text])));
ALTER TABLE public.lifecycle_message_prefs ADD CONSTRAINT lifecycle_message_prefs_mode_check CHECK ((mode = ANY (ARRAY['off'::text, 'draft'::text, 'auto'::text])));
ALTER TABLE public.lifecycle_message_prefs ADD CONSTRAINT lifecycle_prefs_auto_only_logistics CHECK (((mode <> 'auto'::text) OR (event_type = ANY (ARRAY['booking_confirmed'::text, 'reminder_24h'::text]))));
ALTER TABLE public.market_readiness_config ADD CONSTRAINT market_readiness_config_id_check CHECK (id);
ALTER TABLE public.messages ADD CONSTRAINT messages_body_length CHECK (((char_length(TRIM(BOTH FROM body)) >= 1) AND (char_length(TRIM(BOTH FROM body)) <= 4000))) NOT VALID;
ALTER TABLE public.organization_members ADD CONSTRAINT org_members_commission_percent_range CHECK (((commission_type <> 'percent'::text) OR (commission_value <= (100)::numeric)));
ALTER TABLE public.organization_members ADD CONSTRAINT org_members_verified_needs_evidence CHECK (((background_check_status <> 'verified'::text) OR (background_check_completed_at IS NOT NULL)));
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_background_check_status_check CHECK ((background_check_status = ANY (ARRAY['none'::text, 'pending'::text, 'verified'::text, 'flagged'::text])));
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_commission_type_check CHECK ((commission_type = ANY (ARRAY['percent'::text, 'flat'::text])));
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_commission_value_check CHECK ((commission_value >= (0)::numeric));
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'trainer'::text])));
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_event_type_check CHECK ((event_type = ANY (ARRAY['booking_confirmed'::text, 'reminder_24h'::text, 'post_session'::text, 'no_show_followup'::text, 'rebook_nudge'::text])));
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'drafted'::text, 'approved'::text, 'sent'::text, 'skipped'::text])));
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'sent'::text])));
ALTER TABLE public.payment_event_ledger ADD CONSTRAINT payment_event_ledger_amount_minor_check CHECK (((amount_minor IS NULL) OR (amount_minor >= 0)));
ALTER TABLE public.payment_event_ledger ADD CONSTRAINT payment_event_ledger_outcome_check CHECK ((outcome = ANY (ARRAY['applied'::text, 'ignored'::text])));
ALTER TABLE public.plan_entitlements ADD CONSTRAINT plan_entitlements_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])));
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_proposal_type_check CHECK ((proposal_type = ANY (ARRAY['book_service'::text, 'adjust_plan'::text, 'try_provider'::text, 'schedule_change'::text])));
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'declined'::text, 'expired'::text])));
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_request_type_check CHECK ((request_type = ANY (ARRAY['access'::text, 'export'::text, 'correction'::text, 'deletion'::text])));
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'identity_check'::text, 'processing'::text, 'fulfilled'::text, 'denied'::text])));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['searcher'::text, 'provider'::text])));
ALTER TABLE public.program_fixtures ADD CONSTRAINT program_fixtures_home_away_check CHECK ((home_away = ANY (ARRAY['home'::text, 'away'::text, 'neutral'::text])));
ALTER TABLE public.program_fixtures ADD CONSTRAINT program_fixtures_kind_check CHECK ((kind = ANY (ARRAY['game'::text, 'training'::text, 'tournament'::text, 'scrimmage'::text, 'event'::text])));
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500)));
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_status_check CHECK ((status = ANY (ARRAY['waiting'::text, 'offered'::text, 'converted'::text, 'cancelled'::text, 'expired'::text])));
ALTER TABLE public.programs ADD CONSTRAINT programs_average_rating_check CHECK (((average_rating >= (0)::numeric) AND (average_rating <= (5)::numeric)));
ALTER TABLE public.programs ADD CONSTRAINT programs_cancellation_policy_check CHECK ((cancellation_policy = ANY (ARRAY['flexible'::text, 'moderate'::text, 'strict'::text])));
ALTER TABLE public.programs ADD CONSTRAINT programs_enrolled_count_check CHECK ((enrolled_count >= 0));
ALTER TABLE public.programs ADD CONSTRAINT programs_intensity_tier_check CHECK (((intensity_tier >= 0) AND (intensity_tier <= 4)));
ALTER TABLE public.programs ADD CONSTRAINT programs_max_capacity_check CHECK ((max_capacity >= 0));
ALTER TABLE public.programs ADD CONSTRAINT programs_maximum_age_check CHECK ((maximum_age >= 0));
ALTER TABLE public.programs ADD CONSTRAINT programs_minimum_age_check CHECK ((minimum_age >= 0));
ALTER TABLE public.programs ADD CONSTRAINT programs_price_check CHECK ((price >= (0)::numeric));
ALTER TABLE public.programs ADD CONSTRAINT programs_pricing_model_check CHECK ((pricing_model = ANY (ARRAY['single_session'::text, 'monthly'::text, 'seasonal'::text, 'package'::text])));
ALTER TABLE public.programs ADD CONSTRAINT programs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])));
ALTER TABLE public.programs ADD CONSTRAINT programs_total_reviews_check CHECK ((total_reviews >= 0));
ALTER TABLE public.progress_digests ADD CONSTRAINT progress_digests_sessions_counted_check CHECK ((sessions_counted >= 0));
ALTER TABLE public.providers ADD CONSTRAINT providers_account_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'suspended'::text, 'flagged'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_background_check_status_check CHECK ((background_check_status = ANY (ARRAY['verified'::text, 'pending'::text, 'none'::text, 'flagged'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_faq_is_array CHECK ((jsonb_typeof(faq) = 'array'::text));
ALTER TABLE public.providers ADD CONSTRAINT providers_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_plan_status_check CHECK ((plan_status = ANY (ARRAY['none'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['solo'::text, 'organization'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text])));
ALTER TABLE public.providers ADD CONSTRAINT providers_verified_needs_evidence CHECK (((background_check_status <> 'verified'::text) OR (background_check_completed_at IS NOT NULL)));
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_reason_check CHECK (((char_length(TRIM(BOTH FROM reason)) >= 10) AND (char_length(TRIM(BOTH FROM reason)) <= 2000)));
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_requested_amount_check CHECK (((requested_amount IS NULL) OR (requested_amount > (0)::numeric)));
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'reviewing'::text, 'approved'::text, 'denied'::text, 'processing'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE public.reviews ADD CONSTRAINT reviews_author_role_check CHECK (((author_role IS NULL) OR (author_role = ANY (ARRAY['searcher'::text, 'provider'::text]))));
ALTER TABLE public.reviews ADD CONSTRAINT reviews_body_length CHECK (((body IS NULL) OR (char_length(body) <= 4000)));
ALTER TABLE public.reviews ADD CONSTRAINT reviews_published_needs_provenance CHECK (((published_at IS NULL) OR ((author_id IS NOT NULL) AND (booking_id IS NOT NULL))));
ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE public.reviews ADD CONSTRAINT reviews_response_length CHECK (((response_body IS NULL) OR (char_length(response_body) <= 2000)));
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_category_check CHECK ((category = ANY (ARRAY['unsafe_behavior'::text, 'harassment'::text, 'discrimination'::text, 'identity_concern'::text, 'inappropriate_content'::text, 'payment_dispute'::text, 'other'::text])));
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_details_check CHECK (((char_length(TRIM(BOTH FROM details)) >= 10) AND (char_length(TRIM(BOTH FROM details)) <= 4000)));
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_priority_check CHECK ((priority = ANY (ARRAY['untriaged'::text, 'standard'::text, 'urgent'::text, 'emergency'::text])));
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'triaged'::text, 'investigating'::text, 'actioned'::text, 'closed'::text])));
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_effort_check CHECK (((effort IS NULL) OR ((effort >= 1) AND (effort <= 5))));
ALTER TABLE public.sessions ADD CONSTRAINT sessions_capacity_check CHECK ((capacity >= 0));
ALTER TABLE public.sessions ADD CONSTRAINT sessions_capacity_required CHECK (((capacity IS NOT NULL) AND (capacity > 0))) NOT VALID;
ALTER TABLE public.staff_certifications ADD CONSTRAINT staff_certifications_kind_check CHECK ((kind = ANY (ARRAY['cpr'::text, 'first_aid'::text, 'safesport'::text, 'concussion'::text, 'background_check'::text, 'waiver'::text, 'other'::text])));
ALTER TABLE public.staff_certifications ADD CONSTRAINT staff_certifications_status_check CHECK ((status = ANY (ARRAY['none'::text, 'pending'::text, 'verified'::text])));
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_role_check CHECK ((role = ANY (ARRAY['athlete'::text, 'parent'::text, 'coach'::text])));

-- ------------------------------------------------------------ foreign keys (84)
ALTER TABLE public.ai_audit_log ADD CONSTRAINT ai_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ai_audit_log ADD CONSTRAINT ai_audit_log_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE public.athlete_goals ADD CONSTRAINT athlete_goals_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
ALTER TABLE public.athlete_goals ADD CONSTRAINT athlete_goals_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.athletes ADD CONSTRAINT athletes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.billing_subscriptions ADD CONSTRAINT billing_subscriptions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_assigned_member_id_fkey FOREIGN KEY (assigned_member_id) REFERENCES organization_members(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_plan_proposal_id_fkey FOREIGN KEY (plan_proposal_id) REFERENCES plan_proposals(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_searcher_id_fkey FOREIGN KEY (searcher_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE public.coach_agent_turns ADD CONSTRAINT coach_agent_turns_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.coach_agent_turns ADD CONSTRAINT coach_agent_turns_org_id_fkey FOREIGN KEY (org_id) REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_inviter_owner_id_fkey FOREIGN KEY (inviter_owner_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.coach_invites ADD CONSTRAINT coach_invites_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_searcher_id_fkey FOREIGN KEY (searcher_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.development_plans ADD CONSTRAINT development_plans_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES athlete_goals(id) ON DELETE CASCADE;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_opener_id_fkey FOREIGN KEY (opener_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.disputes ADD CONSTRAINT disputes_proposed_session_id_fkey FOREIGN KEY (proposed_session_id) REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_added_by_fkey FOREIGN KEY (added_by) REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE public.facility_notes ADD CONSTRAINT facility_notes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.facility_notes ADD CONSTRAINT facility_notes_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.lifecycle_message_prefs ADD CONSTRAINT lifecycle_message_prefs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_member_user_id_fkey FOREIGN KEY (member_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_child_id_fkey FOREIGN KEY (child_id) REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE public.outbound_messages ADD CONSTRAINT outbound_messages_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_child_id_fkey FOREIGN KEY (child_id) REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.parent_updates ADD CONSTRAINT parent_updates_session_note_id_fkey FOREIGN KEY (session_note_id) REFERENCES session_notes(id) ON DELETE CASCADE;
ALTER TABLE public.payment_event_ledger ADD CONSTRAINT payment_event_ledger_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES development_plans(id) ON DELETE CASCADE;
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_resulting_booking_id_fkey FOREIGN KEY (resulting_booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.plan_proposals ADD CONSTRAINT plan_proposals_service_id_fkey FOREIGN KEY (service_id) REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE public.privacy_requests ADD CONSTRAINT privacy_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.program_fixtures ADD CONSTRAINT program_fixtures_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE public.program_waitlist ADD CONSTRAINT program_waitlist_searcher_id_fkey FOREIGN KEY (searcher_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.programs ADD CONSTRAINT programs_assigned_member_id_fkey FOREIGN KEY (assigned_member_id) REFERENCES organization_members(id) ON DELETE SET NULL;
ALTER TABLE public.programs ADD CONSTRAINT programs_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.progress_digest_sources ADD CONSTRAINT progress_digest_sources_digest_id_fkey FOREIGN KEY (digest_id) REFERENCES progress_digests(id) ON DELETE CASCADE;
ALTER TABLE public.progress_digest_sources ADD CONSTRAINT progress_digest_sources_session_note_id_fkey FOREIGN KEY (session_note_id) REFERENCES session_notes(id) ON DELETE RESTRICT;
ALTER TABLE public.progress_digests ADD CONSTRAINT progress_digests_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
ALTER TABLE public.progress_digests ADD CONSTRAINT progress_digests_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES development_plans(id) ON DELETE CASCADE;
ALTER TABLE public.providers ADD CONSTRAINT providers_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT;
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.review_windows ADD CONSTRAINT review_windows_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewee_id_fkey FOREIGN KEY (reviewee_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE public.safety_reports ADD CONSTRAINT safety_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_child_id_fkey FOREIGN KEY (child_id) REFERENCES athletes(id) ON DELETE SET NULL;
ALTER TABLE public.session_notes ADD CONSTRAINT session_notes_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_assigned_member_id_fkey FOREIGN KEY (assigned_member_id) REFERENCES organization_members(id) ON DELETE SET NULL;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;
ALTER TABLE public.staff_certifications ADD CONSTRAINT staff_certifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE public.team_athletes ADD CONSTRAINT team_athletes_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE;
ALTER TABLE public.team_athletes ADD CONSTRAINT team_athletes_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE public.teams ADD CONSTRAINT teams_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;

-- ------------------------------------------------------------ functions (95)
CREATE OR REPLACE FUNCTION public.admin_set_instant_book(p_provider_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is not null then
    raise exception 'admin_set_instant_book is service-role only';
  end if;
  update public.providers set instant_book_enabled = coalesce(p_enabled, false)
    where id = p_provider_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_set_member_background_check(p_member_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is not null then
    raise exception 'admin_set_member_background_check is service-role only';
  end if;
  if p_status not in ('none','pending','verified','flagged') then
    raise exception 'background_check_status must be none | pending | verified | flagged';
  end if;
  update public.organization_members set background_check_status = p_status where id = p_member_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_set_provider_verification(p_provider_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Defense in depth: service-role only, even if a future migration mistakenly
  -- GRANTs EXECUTE to authenticated. The service role has no end-user JWT, so
  -- auth.uid() is null; any real user (auth.uid() set) is rejected here.
  if auth.uid() is not null then
    raise exception 'admin_set_provider_verification is service-role only';
  end if;
  if p_status not in ('unverified','pending','verified') then
    raise exception 'verification_status must be unverified | pending | verified';
  end if;
  update public.providers
    set verification_status = p_status
    where id = p_provider_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.alert_production_invariants()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; n int := 0;
begin
  for r in select i.area, i.invariant, i.detail
             from public.check_production_invariants() i
            where i.status = 'FAIL'
  loop
    n := n + 1;
    raise log 'INVARIANT FAILED [%]: % — %', r.area, r.invariant, r.detail;
  end loop;
  if n = 0 then
    raise log 'production invariants: all green';
  else
    raise log 'production invariants: % FAILING', n;
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.apply_stripe_billing_event(p_event_id text, p_event_type text, p_provider_id uuid, p_subscription_id text, p_price_id text, p_status text, p_plan text, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_cancel_at_period_end boolean, p_coupon text, p_amount_minor bigint, p_currency text, p_payload_sha256 text, p_occurred_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_new_plan text; v_new_status text;
begin
  -- outcome is CHECK-constrained to {'applied','ignored'} (shared with the
  -- booking ledger). Insert pessimistically as 'ignored'; only a successful
  -- plan projection promotes it to 'applied'. The rich reason is RETURNED
  -- (the edge function logs it) rather than stored — a CHECK cannot enumerate
  -- dynamic strings, and widening it would make the invariant meaningless.
  insert into public.payment_event_ledger
    (stripe_event_id, event_type, booking_id, stripe_object_id,
     amount_minor, currency, payload_sha256, outcome, occurred_at)
  values
    (p_event_id, p_event_type, null, p_subscription_id,
     p_amount_minor, p_currency, p_payload_sha256, 'ignored', p_occurred_at)
  on conflict (stripe_event_id) do nothing;
  if not found then return 'duplicate'; end if;

  if p_subscription_id is not null then
    insert into public.billing_subscriptions
      (provider_id, stripe_subscription_id, stripe_price_id, status,
       current_period_start, current_period_end, cancel_at_period_end, coupon, updated_at)
    values
      (p_provider_id, p_subscription_id, coalesce(p_price_id,''), coalesce(p_status,'unknown'),
       p_period_start, p_period_end, coalesce(p_cancel_at_period_end,false),
       p_coupon, coalesce(p_occurred_at, now()))
    on conflict (stripe_subscription_id) do update
      set stripe_price_id=excluded.stripe_price_id, status=excluded.status,
          current_period_start=excluded.current_period_start,
          current_period_end=excluded.current_period_end,
          cancel_at_period_end=excluded.cancel_at_period_end,
          coupon=excluded.coupon, updated_at=excluded.updated_at
      where public.billing_subscriptions.updated_at <= excluded.updated_at;
    if not found then return 'stale'; end if;
  end if;

  if p_status in ('active','trialing') then
    if p_plan in ('pro','enterprise') then
      v_new_plan := p_plan; v_new_status := p_status;
    else
      return 'ignored_bad_plan:' || coalesce(p_plan,'null');
    end if;
  elsif p_status in ('past_due','unpaid') then
    v_new_plan := null; v_new_status := 'past_due';
  elsif p_status = 'incomplete' then
    v_new_plan := null; v_new_status := 'incomplete';
  elsif p_status in ('canceled','incomplete_expired') then
    v_new_plan := 'free'; v_new_status := 'canceled';
  else
    return 'ignored_unknown_status:' || coalesce(p_status,'null');
  end if;

  update public.providers
    set plan = coalesce(v_new_plan, plan),
        plan_status = v_new_status,
        plan_period_end = p_period_end
    where id = p_provider_id;
  if not found then return 'provider_not_found'; end if;

  update public.payment_event_ledger set outcome = 'applied'
    where stripe_event_id = p_event_id;
  return 'applied:' || coalesce(v_new_plan,'keep') || '/' || v_new_status;
end $function$
;
CREATE OR REPLACE FUNCTION public.apply_stripe_booking_event(p_event_id text, p_event_type text, p_booking_id uuid, p_stripe_object_id text DEFAULT NULL::text, p_amount_minor bigint DEFAULT NULL::bigint, p_currency text DEFAULT NULL::text, p_payload_sha256 text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_payment_intent_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inserted boolean := false;
  v_applied boolean := false;
  v_rows integer := 0;
  v_refund numeric(10,2);
begin
  if coalesce(trim(p_event_id), '') = '' or p_booking_id is null then
    raise exception 'event id and booking id are required';
  end if;

  insert into public.payment_event_ledger(
    stripe_event_id, event_type, booking_id, stripe_object_id, amount_minor,
    currency, payload_sha256, outcome, occurred_at
  ) values (
    p_event_id, p_event_type, p_booking_id, p_stripe_object_id, p_amount_minor,
    upper(p_currency), p_payload_sha256, 'ignored', p_occurred_at
  )
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_rows > 0;
  if not v_inserted then return false; end if;

  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    update public.bookings
       set payment_status = 'paid', status = 'confirmed',
           stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
     where id = p_booking_id
       and payment_status = 'unpaid'
       and status = 'pending'
       and stripe_checkout_session_id = p_stripe_object_id
       and round(final_price * 100)::bigint = p_amount_minor
       and upper(currency) = upper(p_currency);
  elsif p_event_type = 'checkout.session.expired' then
    update public.bookings
       set payment_status = 'failed', status = 'expired'
     where id = p_booking_id
       and stripe_checkout_session_id = p_stripe_object_id
       and payment_status = 'unpaid' and status = 'pending';
  elsif p_event_type in ('charge.refunded','refund.updated') then
    v_refund := round(coalesce(p_amount_minor, 0)::numeric / 100, 2);
    update public.bookings
       set refund_amount = greatest(refund_amount, least(final_price, v_refund)),
           refunded_at = coalesce(p_occurred_at, now()),
           payment_status = case
             when v_refund >= final_price then 'refunded'
             else 'partially_refunded'
           end
     where id = p_booking_id
       and stripe_payment_intent_id = p_payment_intent_id
       and payment_status in ('paid','partially_refunded','refunded');
  end if;
  get diagnostics v_rows = row_count;
  v_applied := v_rows > 0;

  update public.payment_event_ledger
     set outcome = case when v_applied then 'applied' else 'ignored' end
   where stripe_event_id = p_event_id;
  return v_applied;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_stripe_booking_event(p_event_id text, p_event_type text, p_booking_id uuid, p_stripe_object_id text DEFAULT NULL::text, p_amount_minor bigint DEFAULT NULL::bigint, p_currency text DEFAULT NULL::text, p_payload_sha256 text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_payment_intent_id text DEFAULT NULL::text, p_application_fee_minor bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inserted boolean := false;
  v_applied boolean := false;
  v_rows integer := 0;
  v_refund numeric(10,2);
begin
  if coalesce(trim(p_event_id), '') = '' or p_booking_id is null then
    raise exception 'event id and booking id are required';
  end if;

  insert into public.payment_event_ledger(
    stripe_event_id, event_type, booking_id, stripe_object_id, amount_minor,
    currency, payload_sha256, outcome, occurred_at
  ) values (
    p_event_id, p_event_type, p_booking_id, p_stripe_object_id, p_amount_minor,
    upper(p_currency), p_payload_sha256, 'ignored', p_occurred_at
  )
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  v_inserted := v_rows > 0;
  if not v_inserted then return false; end if;

  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then
    update public.bookings
       set payment_status = 'paid', status = 'confirmed',
           stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
           -- the economics, written in the SAME statement that marks it paid, so
           -- a booking can never be paid without its split recorded
           platform_fee = case when p_application_fee_minor is not null
                               then round(p_application_fee_minor::numeric / 100, 2) end,
           platform_fee_bps = case when p_application_fee_minor is not null
                                    and coalesce(p_amount_minor,0) > 0
                               then round(p_application_fee_minor::numeric * 10000 / p_amount_minor) end,
           provider_payout = case when p_application_fee_minor is not null
                               then round((coalesce(p_amount_minor,0) - p_application_fee_minor)::numeric / 100, 2) end,
           fee_recorded_at = case when p_application_fee_minor is not null then now() end
     where id = p_booking_id
       and payment_status = 'unpaid'
       and status = 'pending'
       and stripe_checkout_session_id = p_stripe_object_id
       and round(final_price * 100)::bigint = p_amount_minor
       and upper(currency) = upper(p_currency);
  elsif p_event_type = 'checkout.session.expired' then
    update public.bookings
       set payment_status = 'failed', status = 'expired'
     where id = p_booking_id
       and stripe_checkout_session_id = p_stripe_object_id
       and payment_status = 'unpaid' and status = 'pending';
  elsif p_event_type in ('charge.refunded','refund.updated') then
    v_refund := round(coalesce(p_amount_minor, 0)::numeric / 100, 2);
    update public.bookings
       set refund_amount = greatest(refund_amount, least(final_price, v_refund)),
           refunded_at = coalesce(p_occurred_at, now()),
           payment_status = case
             when v_refund >= final_price then 'refunded'
             else 'partially_refunded'
           end
     where id = p_booking_id
       and stripe_payment_intent_id = p_payment_intent_id
       and payment_status in ('paid','partially_refunded','refunded');
  end if;
  get diagnostics v_rows = row_count;
  v_applied := v_rows > 0;

  update public.payment_event_ledger
     set outcome = case when v_applied then 'applied' else 'ignored' end
   where stripe_event_id = p_event_id;
  return v_applied;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.booking_refund_quote(p_booking_id uuid)
 RETURNS TABLE(refundable_minor bigint, policy text, hours_until numeric, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paid numeric(10,2);
  v_already numeric(10,2);
  v_policy text;
  v_start timestamptz;
  v_hours numeric;
  v_pct numeric;
  v_status text;
begin
  select b.final_price, coalesce(b.refund_amount,0), coalesce(b.cancellation_policy_snapshot,'flexible'),
         b.payment_status,
         -- start_time is text and timezone may be null; a bad parse must not
         -- crash a refund request, so fall back to the date at midnight UTC.
         coalesce(
           (s.start_date::text || ' ' || coalesce(nullif(s.start_time,''),'00:00'))::timestamp
             at time zone coalesce(nullif(s.timezone,''),'UTC'),
           s.start_date::timestamptz)
    into v_paid, v_already, v_policy, v_status, v_start
    from public.bookings b
    left join public.sessions s on s.id = b.session_id
   where b.id = p_booking_id;

  if v_paid is null then
    return query select 0::bigint, 'unknown'::text, 0::numeric, 'booking not found'::text; return;
  end if;
  if v_status <> 'paid' then
    return query select 0::bigint, v_policy, 0::numeric,
      ('nothing to refund: payment status is ' || coalesce(v_status,'unknown'))::text; return;
  end if;

  v_hours := extract(epoch from (coalesce(v_start, now()) - now())) / 3600.0;

  -- The published ladder. flexible is the only policy in use today; the others
  -- are here so adding one to a program does not silently fall through to 100%.
  v_pct := case
    when v_policy = 'flexible' then case when v_hours >= 24 then 1.0 else 0.0 end
    when v_policy = 'moderate' then case when v_hours >= 120 then 1.0
                                         when v_hours >= 24  then 0.5 else 0.0 end
    when v_policy = 'strict'   then case when v_hours >= 168 then 0.5 else 0.0 end
    else case when v_hours >= 24 then 1.0 else 0.0 end   -- unknown label: treat as flexible
  end;

  return query select
    greatest(0, round((v_paid * v_pct - v_already) * 100))::bigint,
    v_policy,
    round(v_hours, 1),
    case when v_pct = 0 then 'outside the ' || v_policy || ' refund window'
         when v_pct = 1 then 'full refund under the ' || v_policy || ' policy'
         else (v_pct*100)::int || '% refund under the ' || v_policy || ' policy' end::text;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.check_cron_http_health()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_failed int; v_ok int; r record;
begin
  -- Reconcile every unchecked request against net._http_response. That table is
  -- pruned aggressively, so anything older than an hour with no response row is
  -- recorded as lost rather than left pending forever.
  update public.cron_http_audit a
     set status_code = resp.status_code,
         checked_at  = now(),
         error_msg   = case when resp.status_code between 200 and 299 then null
                            else left(coalesce(resp.content, resp.error_msg, ''), 300) end
    from net._http_response resp
   where resp.id = a.request_id and a.checked_at is null;

  update public.cron_http_audit
     set checked_at = now(), error_msg = 'no response row (pruned or never returned)'
   where checked_at is null and queued_at < now() - interval '1 hour';

  -- Alert on the last 15 minutes. raise log lands in Postgres logs, which is a
  -- surface that actually gets read — unlike net._http_response, which nothing
  -- was watching while 63,000 ticks failed.
  for r in
    select job_name,
           count(*) filter (where status_code between 200 and 299) as ok,
           count(*) filter (where status_code is not null and (status_code < 200 or status_code >= 300)) as failed,
           max(status_code) filter (where status_code < 200 or status_code >= 300) as sample_code
    from public.cron_http_audit
    where queued_at > now() - interval '15 minutes'
    group by job_name
  loop
    if r.failed > 0 then
      raise log 'CRON HTTP FAILURE: job=% failed=% ok=% sample_status=% — the cron reports success; the HTTP call does not.',
        r.job_name, r.failed, r.ok, r.sample_code;
    end if;
  end loop;

  delete from public.cron_http_audit where queued_at < now() - interval '14 days';
end $function$
;

CREATE OR REPLACE FUNCTION public.check_production_invariants()
 RETURNS TABLE(area text, invariant text, status text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_bad int; v_txt text;
begin
  return query select 'consent'::text,'athlete consent trigger exists'::text,
    (case when exists(select 1 from pg_trigger where tgname='trg_enforce_athlete_consent') then 'PASS' else 'FAIL' end)::text,
    'without it a minor can be recorded with no parental consent'::text;
  return query select 'consent'::text,'booking consent trigger exists'::text,
    (case when exists(select 1 from pg_trigger where tgname='trg_enforce_booking_athlete_consent') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'consent'::text,'no athlete lacks consent'::text,
    (case when (select count(*) from public.athletes a where a.parent_consent is not true or a.consent_at is null or a.consent_version is null)=0 then 'PASS' else 'FAIL' end)::text,
    (select count(*)::text||' athlete row(s) violate the consent gate' from public.athletes a where a.parent_consent is not true or a.consent_at is null or a.consent_version is null)::text;
  return query select 'consent'::text,'no booking on an unconsented athlete'::text,
    (case when (select count(*) from public.bookings b join public.athletes a on a.id=b.athlete_id where a.parent_consent is not true)=0 then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'safety'::text,'browse policy is approval-gated'::text,
    (case when exists(select 1 from pg_policies pol where pol.schemaname='public' and pol.policyname='providers_select_public' and pol.qual like '%approved%') then 'PASS' else 'FAIL' end)::text,
    'browsing shows approved providers; BOOKING carries the bg-check gate (see next invariants)'::text;
  return query select 'safety'::text,'search is bgcheck-gated'::text,
    (case when (select position('provider_safety_cleared' in pg_get_functiondef(p.oid))>0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='search_candidates') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'safety'::text,'booking is bgcheck-gated'::text,
    (case when exists(select 1 from pg_trigger where tgname='trg_enforce_booking_provider_verified') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'safety'::text,'bgcheck column is server-controlled'::text,
    (case when (select position('background_check_status' in pg_get_functiondef(p.oid))>0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enforce_provider_trust') then 'PASS' else 'FAIL' end)::text,'else a coach can self-verify'::text;
  return query select 'safety'::text,'verified badge carries a completion date'::text,
    (case when (select count(*) from public.providers pv where pv.background_check_status='verified' and pv.background_check_completed_at is null)=0 then 'PASS' else 'FAIL' end)::text,
    (select count(*)::text||' provider row(s) claim a check that never ran' from public.providers pv where pv.background_check_status='verified' and pv.background_check_completed_at is null)::text;
  return query select 'safety'::text,'org cannot self-verify trainers'::text,
    (case when (select position('server-controlled' in pg_get_functiondef(p.oid))>0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enforce_org_member') then 'PASS' else 'FAIL' end)::text,''::text;
  if to_regclass('public.staff_certifications') is null then
    return query select 'safety'::text,'org cannot self-verify a staff cert'::text,'N/A'::text,'staff_certifications table not present'::text;
  else
    return query select 'safety'::text,'org cannot self-verify a staff cert'::text,
      (case when exists(select 1 from pg_policies pol where pol.schemaname='public' and pol.tablename='staff_certifications' and pol.policyname='staff_certifications_admin_all' and pol.with_check like '%pending%' and pol.with_check like '%none%') then 'PASS' else 'FAIL' end)::text,
      'admin write policy must cap status at none/pending; only the service-role webhook sets verified — else a director self-clears staff'::text;
  end if;
  return query select 'privacy'::text,'anon cannot read exact coordinates'::text,
    (case when not has_column_privilege('anon','public.providers','latitude','SELECT') and not has_column_privilege('anon','public.providers','longitude','SELECT') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'privacy'::text,'anon cannot read stripe_account_id'::text,
    (case when not has_column_privilege('anon','public.providers','stripe_account_id','SELECT') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'privacy'::text,'anon cannot read owner_id'::text,
    (case when not has_column_privilege('anon','public.providers','owner_id','SELECT') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'privacy'::text,'authenticated cannot read exact coordinates'::text,
    (case when not has_column_privilege('authenticated','public.providers','latitude','SELECT') and not has_column_privilege('authenticated','public.providers','longitude','SELECT') then 'PASS' else 'FAIL' end)::text,
    'any signed-in free account could otherwise read every coach home GPS'::text;
  return query select 'privacy'::text,'authenticated cannot read stripe ids'::text,
    (case when not has_column_privilege('authenticated','public.providers','stripe_account_id','SELECT') and not has_column_privilege('authenticated','public.providers','stripe_customer_id','SELECT') then 'PASS' else 'FAIL' end)::text,
    'Connect + billing customer ids must not be readable by other signed-in users'::text;
  return query select 'privacy'::text,'public coords stay in sync'::text,
    (case when exists(select 1 from pg_trigger where tgname='trg_sync_public_coords') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'money'::text,'booking financial columns frozen'::text,
    (case when (select position('payment_status is distinct from' in pg_get_functiondef(p.oid))>0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enforce_booking_provider_update') then 'PASS' else 'FAIL' end)::text,'else a parent can mark their own booking paid'::text;
  if to_regclass('public.platform_fees') is null then
    return query select 'money'::text,'every platform_fees row is 1200 bps'::text,'N/A'::text,'table not applied yet'::text;
  else
    execute 'select count(*), coalesce(string_agg(fee_kind || ''='' || rate_bps, '', ''), ''ok'') from public.platform_fees where rate_bps <> 1200' into v_bad, v_txt;
    return query select 'money'::text,'every platform_fees row is 1200 bps'::text,
      (case when v_bad=0 then 'PASS' else 'FAIL' end)::text,(case when v_bad=0 then 'flat 12% holds' else v_txt end)::text;
  end if;
  return query select 'money'::text,'stripe webhook is idempotent'::text,
    (case when coalesce((select bool_and(position('stripe_event_id' in pg_get_functiondef(p.oid))>0) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_stripe_booking_event'), false) then 'PASS' else 'FAIL' end)::text,
    'every overload of apply_stripe_booking_event must key on stripe_event_id'::text;
  return query select 'rls'::text,'every public table has RLS enabled'::text,
    (case when (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)=0 then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(c.relname,', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),'all covered')::text;
  return query select 'rls'::text,'no anon policy uses USING (true)'::text,
    (case when (select count(*) from pg_policies pol where pol.schemaname='public' and 'anon'=any(pol.roles) and pol.qual='true' and pol.tablename <> 'plan_entitlements')=0 then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(pol.tablename||'.'||pol.policyname,', ') from pg_policies pol where pol.schemaname='public' and 'anon'=any(pol.roles) and pol.qual='true' and pol.tablename <> 'plan_entitlements'),'none')::text;
  return query select 'rls'::text,'no authenticated policy uses USING (true)'::text,
    (case when (select count(*) from pg_policies pol where pol.schemaname='public' and 'authenticated'=any(pol.roles) and pol.qual='true' and pol.tablename <> 'plan_entitlements')=0 then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(pol.tablename||'.'||pol.policyname,', ') from pg_policies pol where pol.schemaname='public' and 'authenticated'=any(pol.roles) and pol.qual='true' and pol.tablename <> 'plan_entitlements'),'none (plan_entitlements price list excepted)')::text;
  return query select 'rls'::text,'role escalation is blocked'::text,
    (case when exists(select 1 from pg_trigger where tgname='profiles_role_immutable') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'integrity'::text,'no orphaned auth users'::text,
    (case when (select count(*) from auth.users u left join public.profiles pr on pr.id=u.id where pr.id is null)=0 then 'PASS' else 'FAIL' end)::text,
    (select count(*)::text||' user(s) authenticate with no profile row' from auth.users u left join public.profiles pr on pr.id=u.id where pr.id is null)::text;
  return query select 'integrity'::text,'approved providers completed onboarding'::text,
    (case when (select count(*) from public.providers pv where pv.status='approved' and coalesce(pv.onboarding_completed,false)=false)=0 then 'PASS' else 'FAIL' end)::text,
    'else they silently demote on the next providers UPDATE'::text;
  return query select 'integrity'::text,'no unprovenanced review is published'::text,
    (case when (select count(*) from public.reviews r where r.published_at is not null and r.booking_id is null)=0 then 'PASS' else 'FAIL' end)::text,
    'a review with no booking behind it must never render on a listing'::text;
  return query select 'integrity'::text,'marketplace has bookable inventory'::text,
    (case when (select count(*) from public.sessions s join public.programs p on p.id=s.program_id
                 where p.status='published' and s.start_date >= current_date
                   and public.provider_safety_cleared(p.provider_id))>0 then 'PASS' else 'FAIL' end)::text,
    'seed sessions age out silently and leave nothing to book'::text;
  return query select 'ops'::text,'cron HTTP calls are succeeding'::text,
    (case when (select count(*) from public.cron_latest_status cl where cl.status_code not between 200 and 299)=0 then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(cl.job_name||'='||cl.status_code,', ') from public.cron_latest_status cl where cl.status_code not between 200 and 299),'all green')::text;
  return query select 'ops'::text,'cron secret is single-sourced'::text,
    (case when exists(select 1 from vault.secrets vs where vs.name='cron_secret') then 'PASS' else 'FAIL' end)::text,''::text;
  return query select 'money'::text,'no paid booking on an unpayable provider'::text,
    (case when (select count(*) from public.bookings b
                 join public.programs pr on pr.id=b.program_id
                 join public.providers pv on pv.id=pr.provider_id
                where b.payment_status='paid' and coalesce(pv.stripe_charges_enabled,false)=false)=0 then 'PASS' else 'FAIL' end)::text,
    'else a family was charged for a coach who cannot receive the payout'::text;
  return query select 'money'::text,'plan projection matches the subscription mirror'::text,
    (case when (select count(*) from public.providers pv
                where (pv.plan in ('pro','enterprise')
                       and not exists(select 1 from public.billing_subscriptions bs
                                       where bs.provider_id=pv.id and bs.status in ('active','trialing','past_due')))
                   or (exists(select 1 from public.billing_subscriptions bs
                               where bs.provider_id=pv.id and bs.status in ('active','trialing'))
                       and pv.plan='free' and pv.plan_status not in ('canceled')))=0 then 'PASS' else 'FAIL' end)::text,
    'else providers.plan and billing_subscriptions disagree (webhook projection drift)'::text;
  return query select 'ops'::text,'cron timeout rate under 2%'::text,
    (case when coalesce((select max(h.timed_out::numeric / nullif(h.attempts_24h,0))
                          from public.cron_http_health h), 0) <= 0.02 then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(h.job_name||'='||round(100.0*h.timed_out/nullif(h.attempts_24h,0),1)||'%', ', ')
              from public.cron_http_health h
              where h.timed_out::numeric / nullif(h.attempts_24h,0) > 0.02),'all under 2%')::text;
  return query select 'ops'::text,'no stale webhook dead-letters'::text,
    (case when (select count(*) from public.webhook_dead_letter
                where resolved_at is null and first_seen_at < now() - interval '1 hour')=0 then 'PASS' else 'FAIL' end)::text,
    coalesce((select string_agg(coalesce(stripe_event_id,'?')||' ('||coalesce(event_type,'?')||')', ', ')
              from public.webhook_dead_letter
              where resolved_at is null and first_seen_at < now() - interval '1 hour'),'none')::text;
end $function$
;
CREATE OR REPLACE FUNCTION public.claim_organization_role()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  update public.providers
     set provider_type = 'organization'
   where owner_id = v_uid and provider_type = 'solo';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_provider_role()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'authentication required'; end if;

  perform set_config('sporve.role_claim', 'on', true);

  update public.profiles
     set role = 'provider'
   where id = v_uid and role = 'searcher';

  insert into public.providers (owner_id, business_name)
  values (v_uid, coalesce(
    (select nullif(trim(concat_ws(' ', first_name, last_name)),'')
       from public.profiles where id = v_uid), 'My Academy'))
  on conflict (owner_id) do nothing;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_kind text DEFAULT 'command_bar'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_provider uuid;
  v_plan text;
  v_quota int;
  v_used int;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  end if;
  select id, plan into v_provider, v_plan
    from public.providers where owner_id = auth.uid();
  if v_provider is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_a_coach');
  end if;

  select ai_monthly_quota into v_quota
    from public.plan_entitlements where plan = v_plan;
  -- null quota = unlimited (pro/enterprise). Still metered for observability.
  if v_quota is null then
    insert into public.ai_usage (provider_id, kind)
      values (v_provider, left(coalesce(nullif(p_kind,''),'command_bar'), 40));
    return jsonb_build_object('allowed', true, 'plan', v_plan, 'quota', null);
  end if;

  perform pg_advisory_xact_lock(hashtext(v_provider::text));
  select count(*) into v_used from public.ai_usage
    where provider_id = v_provider
      and used_at >= date_trunc('month', now());
  if v_used >= v_quota then
    return jsonb_build_object('allowed', false, 'reason', 'quota_exhausted',
                              'plan', v_plan, 'used', v_used, 'quota', v_quota);
  end if;
  insert into public.ai_usage (provider_id, kind)
    values (v_provider, left(coalesce(nullif(p_kind,''),'command_bar'), 40));
  return jsonb_build_object('allowed', true, 'plan', v_plan,
                            'used', v_used + 1, 'quota', v_quota);
end $function$
;
CREATE OR REPLACE FUNCTION public.consume_edge_rate_limit(p_actor_key text, p_scope text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_actor_key is null or length(p_actor_key) < 1 or length(p_actor_key) > 160
     or p_scope is null or length(p_scope) < 1 or length(p_scope) > 80
     or p_limit < 1 or p_limit > 100000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds)
    * p_window_seconds
  );

  if random() < 0.01 then
    delete from public.edge_rate_limits
    where window_start < clock_timestamp() - interval '2 days';
  end if;

  insert into public.edge_rate_limits(actor_key, scope, window_start, request_count)
  values (p_actor_key, p_scope, v_window, 1)
  on conflict (actor_key, scope, window_start)
  do update set request_count = public.edge_rate_limits.request_count + 1
    where public.edge_rate_limits.request_count < p_limit
  returning request_count into v_count;

  return v_count is not null and v_count <= p_limit;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.data_health()
 RETURNS TABLE(severity text, check_name text, failing_count bigint, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- a listing nobody can book is worse than no listing: it wastes the click
  select 'critical', 'programs_without_future_sessions',
         count(*),
         'Listings shown to visitors with no bookable session. They open it and find nothing.'
  from (select p.id from public.programs p
        left join public.sessions s on s.program_id=p.id and s.start_date>=current_date
        group by p.id having count(s.id)=0) x
  having count(*) > 0

  union all
  -- the capacity trigger cannot refuse a booking it has no limit for
  select 'critical', 'sessions_without_capacity', count(*),
         'Sessions with no cap — overbooking cannot be prevented on these.'
  from public.sessions where capacity is null
  having count(*) > 0

  union all
  -- the single promise this marketplace makes to a parent
  select 'critical', 'providers_verified_without_evidence', count(*),
         'Providers flagged verified with no completion timestamp behind it.'
  from public.providers
  where background_check_status='verified' and background_check_completed_at is null
  having count(*) > 0

  union all
  -- money that moved with no record of the split
  select 'high', 'paid_bookings_without_fee', count(*),
         'Bookings marked paid with no platform_fee recorded — revenue is unknowable for these.'
  from public.bookings where payment_status='paid' and platform_fee is null
  having count(*) > 0

  union all
  -- fabricated social proof
  select 'high', 'reviews_published_without_provenance', count(*),
         'Published reviews with no author or no booking behind them.'
  from public.reviews
  where published_at is not null and (author_id is null or booking_id is null)
  having count(*) > 0

  union all
  -- the webhook has never delivered; without this nothing marks a booking paid
  select 'critical', 'stripe_events_never_received', count(*),
         'Bookings reached Stripe checkout but the webhook ledger is empty — payments never confirm.'
  from public.bookings b
  where b.stripe_checkout_session_id is not null
    and not exists (select 1 from public.payment_event_ledger)
  having count(*) > 0

  union all
  -- a catalogue that cannot be booked at all
  select 'critical', 'no_bookable_supply', count(*),
         'Programs whose provider cannot pass the safety gate — invisible to booking.'
  from public.programs p
  join public.providers pv on pv.id=p.provider_id
  where not public.provider_safety_cleared(pv.id)
  having count(*) > 0
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_athlete_consent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if coalesce(new.parent_consent, false) is not true then
    raise exception 'parental consent (parent_consent = true) is required before an athlete record can exist (COPPA)';
  end if;
  if new.consent_version is null or char_length(trim(new.consent_version)) = 0 then
    raise exception 'consent_version (the consent text version the parent accepted) is required';
  end if;
  if new.consent_at is null then
    new.consent_at := now();
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_athlete_consent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_consent boolean;
begin
  if new.athlete_id is null then
    return new;
  end if;
  select a.parent_consent into v_consent
    from public.athletes a where a.id = new.athlete_id;
  if v_consent is null then
    raise exception 'booking references a non-existent athlete';
  end if;
  if v_consent is not true then
    raise exception 'cannot book: parental consent is not on file for this athlete (COPPA)';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_fee_server_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then return new; end if;   -- service role / webhook: allowed
  if tg_op = 'INSERT' then
    new.platform_fee := null; new.platform_fee_bps := null;
    new.provider_payout := null; new.fee_recorded_at := null;
  elsif tg_op = 'UPDATE'
    and (new.platform_fee     is distinct from old.platform_fee
      or new.platform_fee_bps is distinct from old.platform_fee_bps
      or new.provider_payout  is distinct from old.provider_payout
      or new.fee_recorded_at  is distinct from old.fee_recorded_at) then
    raise exception 'platform fee fields are server-controlled and cannot be self-set';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_member_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid;
begin
  -- null = "any available trainer" — nothing to validate.
  if new.assigned_member_id is null then
    return new;
  end if;

  -- Resolve the org that owns this booking. Prefer the booking's program; fall
  -- back to the session's program when program_id is null (live: session_id is
  -- NOT NULL, program_id is nullable).
  if new.program_id is not null then
    select pr.provider_id into v_org
      from public.programs pr
      where pr.id = new.program_id;
  elsif new.session_id is not null then
    select pr.provider_id into v_org
      from public.sessions s
      join public.programs pr on pr.id = s.program_id
      where s.id = new.session_id;
  end if;

  -- Fail CLOSED: an assigned trainer with no resolvable owning org cannot be
  -- validated, so it cannot be trusted.
  if v_org is null then
    raise exception 'assigned_member_id set but booking has no resolvable program/org to validate against';
  end if;

  if not exists (select 1 from public.organization_members m
                 where m.id = new.assigned_member_id
                   and m.organization_id = v_org) then
    raise exception 'assigned_member_id must be a roster member of this booking''s program''s organization';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_program_matches_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_program uuid;
begin
  if new.session_id is null then
    raise exception 'a booking must name the session being booked';
  end if;
  select s.program_id into v_program from public.sessions s where s.id = new.session_id;
  if v_program is null then
    raise exception 'session % does not resolve to a program', new.session_id;
  end if;
  new.program_id := v_program;      -- authoritative; the client's value is discarded
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_provider_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean := old.searcher_id = v_uid;
  v_is_provider boolean := exists (
    select 1 from public.sessions s
    join public.programs pr on pr.id = s.program_id
    join public.providers pv on pv.id = pr.provider_id
    where s.id = old.session_id and pv.owner_id = v_uid
  );
begin
  if v_uid is null then return new; end if;

  if new.searcher_id is distinct from old.searcher_id
   or new.session_id is distinct from old.session_id
   or new.athlete_id is distinct from old.athlete_id
   or new.program_id is distinct from old.program_id
   or new.athlete_first_name is distinct from old.athlete_first_name
   or new.athlete_age_band is distinct from old.athlete_age_band
   or new.selected_tier is distinct from old.selected_tier
   or new.original_price is distinct from old.original_price
   or new.final_price is distinct from old.final_price
   or new.currency is distinct from old.currency
   or new.cancellation_policy_snapshot is distinct from old.cancellation_policy_snapshot
   or new.payment_status is distinct from old.payment_status
   or new.refund_amount is distinct from old.refund_amount
   or new.refunded_at is distinct from old.refunded_at
   or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'Not allowed to modify booking financial or identity fields';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'cancelled'
       and old.status in ('pending','confirmed')
       and (v_is_owner or v_is_provider) then
      new.cancelled_at := coalesce(new.cancelled_at, now());
      new.cancelled_by := v_uid;
    elsif new.status = 'declined' and old.status = 'pending' and v_is_provider then
      null;
    elsif new.status in ('completed','no_show')
       and old.status = 'confirmed' and v_is_provider then
      null;
    else
      raise exception 'Invalid booking status transition';
    end if;
  elsif new.cancelled_at is distinct from old.cancelled_at
     or new.cancelled_by is distinct from old.cancelled_by
     or new.cancellation_reason is distinct from old.cancellation_reason then
    raise exception 'Cancellation metadata requires a cancellation transition';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_provider_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_provider uuid;
begin
  if new.program_id is not null then
    select pr.provider_id into v_provider from public.programs pr where pr.id = new.program_id;
  elsif new.session_id is not null then
    select pr.provider_id into v_provider
      from public.sessions s join public.programs pr on pr.id = s.program_id
      where s.id = new.session_id;
  end if;
  if v_provider is null then
    raise exception 'booking has no resolvable program/provider to verify against';
  end if;
  if not public.provider_safety_cleared(v_provider) then
    raise exception 'cannot book: provider is not background-check verified and active';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_booking_session_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_capacity integer;
  v_taken    integer;
begin
  if new.session_id is null then
    return new;
  end if;
  if new.status not in ('pending','confirmed') then
    return new;
  end if;

  select s.capacity into v_capacity
    from public.sessions s where s.id = new.session_id;
  if v_capacity is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('session:' || new.session_id::text));

  select count(*)::int into v_taken
    from public.bookings b
    where b.session_id = new.session_id
      and b.status in ('pending','confirmed')
      and b.id <> new.id;

  if v_taken >= v_capacity then
    raise exception 'session is full (% of % seats taken)', v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_coach_agent_turn_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.coach_id := auth.uid();
    return new;
  end if;
  if new.coach_id   is distinct from old.coach_id
   or new.input_text is distinct from old.input_text
   or new.created_at is distinct from old.created_at then
    raise exception 'coach_agent_turns identity fields are immutable';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_coach_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;
begin
  if tg_op = 'INSERT' then
    select owner_id into v_owner from public.providers where id = new.provider_id;
    if v_owner is null then raise exception 'coach_invite requires an existing provider'; end if;
    if auth.uid() is not null and v_owner is distinct from auth.uid() then
      raise exception 'only the coach who owns this provider may create invites';
    end if;
    new.inviter_owner_id := v_owner;
    new.token       := replace(gen_random_uuid()::text, '-', '')
                     || replace(gen_random_uuid()::text, '-', '');
    new.status      := 'pending';
    new.redeemed_by := null;
    new.redeemed_at := null;
    new.created_at  := now();
    new.updated_at  := now();
    return new;
  end if;
  if coalesce(current_setting('sporve.invite_redeem', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if new.provider_id      is distinct from old.provider_id
   or new.inviter_owner_id is distinct from old.inviter_owner_id
   or new.token           is distinct from old.token then
    raise exception 'coach_invite identity fields are immutable';
  end if;
  if new.redeemed_by is distinct from old.redeemed_by
   or new.redeemed_at is distinct from old.redeemed_at then
    raise exception 'redemption is server-controlled (use redeem_coach_invite)';
  end if;
  if old.status = 'accepted' and new.status is distinct from old.status then
    raise exception 'an accepted invite cannot change status';
  end if;
  if new.status not in ('pending','revoked','expired') then
    raise exception 'coach_invite status may only be set to revoked or expired here';
  end if;
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_dispute_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pay text; v_searcher uuid;
begin
  if auth.uid() is null then return new; end if;
  if new.opener_id is distinct from auth.uid() then
    raise exception 'opener_id must be the authenticated user';
  end if;
  if new.status <> 'open' or new.resolution <> 'none'
     or new.resolution_amount <> 0 or new.decided_by is not null
     or new.resolved_at is not null then
    raise exception 'a dispute opens in state open with no resolution fields set';
  end if;
  select b.payment_status, b.searcher_id into v_pay, v_searcher
    from public.bookings b where b.id = new.booking_id;
  if v_pay is null then raise exception 'dispute references a non-existent booking'; end if;
  if v_pay not in ('paid','partially_refunded','refunded') then
    raise exception 'only a paid booking can be disputed';
  end if;
  if new.opener_role = 'searcher' then
    if v_searcher is distinct from auth.uid() then
      raise exception 'opener_role searcher must be the booking family';
    end if;
  elsif new.opener_role = 'provider' then
    if not public.is_booking_provider_owner(new.booking_id) then
      raise exception 'opener_role provider must be the booking coach';
    end if;
  end if;
  if not public.is_booking_party(new.booking_id) then
    raise exception 'only a party to the booking may open a dispute';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_dispute_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_final numeric(10,2);
begin
  if auth.uid() is null then
    if new.status = 'resolved' then
      new.resolved_at := coalesce(new.resolved_at, now());
      select b.final_price into v_final from public.bookings b where b.id = new.booking_id;
      if new.resolution in ('refund','partial_refund','credit')
         and (new.resolution_amount <= 0 or new.resolution_amount > coalesce(v_final, new.resolution_amount)) then
        raise exception 'resolution_amount must be > 0 and <= the booking price';
      end if;
    end if;
    return new;
  end if;
  if new.booking_id  is distinct from old.booking_id
   or new.opener_id  is distinct from old.opener_id
   or new.opener_role is distinct from old.opener_role
   or new.type       is distinct from old.type
   or new.resolution is distinct from old.resolution
   or new.resolution_amount is distinct from old.resolution_amount
   or new.decided_by is distinct from old.decided_by
   or new.resolved_at is distinct from old.resolved_at then
    raise exception 'dispute identity and resolution fields are mediator-controlled';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'withdrawn' and old.status in ('open','awaiting_counterparty')
       and old.opener_id = auth.uid() then
      null;
    elsif old.type = 'reschedule' and public.is_booking_party(old.booking_id)
       and ((old.status = 'open' and new.status = 'awaiting_counterparty')
            or (old.status = 'awaiting_counterparty' and new.status = 'open')) then
      null;
    else
      raise exception 'invalid dispute status transition for a party';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_message_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_minute boolean;
  v_day boolean;
begin
  if v_actor is null then return new; end if;
  select public.consume_edge_rate_limit(
    'user:' || v_actor::text, 'message:minute', 60, 60
  ) into v_minute;
  select public.consume_edge_rate_limit(
    'user:' || v_actor::text, 'message:day', 1000, 86400
  ) into v_day;
  if not v_minute or not v_day then
    raise exception 'message rate limit reached';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_org_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_is_admin boolean;
begin
  -- The org must actually be an organization.
  if not exists (select 1 from public.providers p
                 where p.id = new.organization_id and p.provider_type = 'organization') then
    raise exception 'organization_id must reference a provider_type = ''organization'' row';
  end if;

  -- Service role (admin backend / background-check webhook): fully trusted.
  -- No end-user JWT, so auth.uid() is null — this is how bg-status gets set.
  if auth.uid() is null then
    return new;
  end if;

  -- background_check_status: server-controlled for every end-user path.
  if tg_op = 'INSERT' then
    new.background_check_status := 'none';           -- born unverified, always
  elsif new.background_check_status is distinct from old.background_check_status then
    raise exception 'background_check_status is server-controlled — an org cannot verify its own trainers';
  end if;

  v_is_admin := public.is_org_admin(new.organization_id);
  if v_is_admin then
    return new;                                       -- admins own role/is_active/profile/linkage
  end if;

  -- Otherwise this is a trainer editing their own row (RLS guarantees
  -- member_user_id = auth.uid()): profile fields ONLY.
  if tg_op = 'UPDATE' then
    if new.role            is distinct from old.role
    or new.is_active       is distinct from old.is_active
    or new.organization_id is distinct from old.organization_id
    or new.member_user_id  is distinct from old.member_user_id then
      raise exception 'trainers may edit only their own profile, not role / status / linkage';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_program_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.assigned_member_id is not null
     and not exists (select 1 from public.organization_members m
                     where m.id = new.assigned_member_id
                       and m.organization_id = new.provider_id) then
    raise exception 'assigned_member_id must be a roster member of this program''s provider';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_provider_availability_signals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.instant_book_enabled := false;
    return new;
  end if;
  if new.instant_book_enabled is distinct from old.instant_book_enabled then
    raise exception 'instant_book_enabled is earned and server-controlled';
  end if;
  if new.last_active_at is not null and new.last_active_at > now() + interval '2 minutes' then
    raise exception 'last_active_at cannot be set in the future';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_provider_trust()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.verification_status     := 'unverified';
    new.background_check_status := 'none';
    new.background_check_completed_at := null;
    new.account_status          := 'active';
    new.stripe_charges_enabled  := false;
    new.stripe_account_id       := null;
    new.stripe_customer_id      := null;
    new.plan                    := 'free';
    new.plan_status             := 'none';
    new.plan_period_end         := null;
    new.founding_coach          := false;
  elsif tg_op = 'UPDATE' then
    if new.verification_status      is distinct from old.verification_status
     or new.background_check_status is distinct from old.background_check_status
     or new.background_check_completed_at is distinct from old.background_check_completed_at
     or new.account_status          is distinct from old.account_status
     or new.stripe_account_id       is distinct from old.stripe_account_id
     or new.stripe_charges_enabled  is distinct from old.stripe_charges_enabled
     or new.stripe_customer_id      is distinct from old.stripe_customer_id
     or new.plan                    is distinct from old.plan
     or new.plan_status             is distinct from old.plan_status
     or new.plan_period_end         is distinct from old.plan_period_end
     or new.founding_coach          is distinct from old.founding_coach then
      raise exception
        'verification / background-check / account / stripe / plan fields are server-controlled and cannot be self-set';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status in ('suspended','rejected') then
    new.status := old.status;
  else
    new.status := case when coalesce(new.onboarding_completed, false) then 'approved' else 'pending' end;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_review_authorship()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_status text; v_pay text;
begin
  if auth.uid() is null then return new; end if;
  if new.booking_id is null or new.author_role is null then
    raise exception 'a review must reference a booking and an author_role';
  end if;
  if new.published_at is not null or new.response_body is not null or new.response_at is not null then
    raise exception 'published_at / response are server-controlled and must be null on insert';
  end if;
  if new.author_id is distinct from auth.uid() then
    raise exception 'author_id must be the authenticated user';
  end if;
  select b.status, b.payment_status into v_status, v_pay
    from public.bookings b where b.id = new.booking_id;
  if v_status is null then
    raise exception 'review references a non-existent booking';
  end if;
  if v_status <> 'completed' or v_pay not in ('paid','partially_refunded') then
    raise exception 'only a completed, paid booking can be reviewed';
  end if;
  if new.author_role = 'searcher' then
    if not public.is_booking_searcher(new.booking_id) then
      raise exception 'only the booking''s family may leave a family review';
    end if;
  elsif new.author_role = 'provider' then
    if not public.is_booking_provider_owner(new.booking_id) then
      raise exception 'only the booking''s coach may leave a coach review';
    end if;
  else
    raise exception 'author_role must be searcher or provider';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_review_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null
     or coalesce(current_setting('sporve.review_publish', true), '') = 'on' then
    return new;
  end if;
  if new.published_at is distinct from old.published_at then
    raise exception 'published_at is server-controlled (set only on double-blind release)';
  end if;
  if new.booking_id  is distinct from old.booking_id
   or new.author_id  is distinct from old.author_id
   or new.author_role is distinct from old.author_role
   or new.program_id is distinct from old.program_id then
    raise exception 'review identity fields are immutable';
  end if;
  if (new.response_body is distinct from old.response_body
      or new.response_at is distinct from old.response_at)
     and new.rating = old.rating
     and new.body is not distinct from old.body then
    if old.author_role <> 'searcher' then
      raise exception 'a response may only be added to a family review';
    end if;
    if old.published_at is null then
      raise exception 'cannot respond before the review is published';
    end if;
    if not public.is_booking_provider_owner(old.booking_id) then
      raise exception 'only the reviewed coach may respond';
    end if;
    new.response_at := coalesce(new.response_at, now());
    return new;
  end if;
  if new.response_body is distinct from old.response_body
   or new.response_at  is distinct from old.response_at then
    raise exception 'only the reviewed coach may set a response';
  end if;
  if old.published_at is not null then
    raise exception 'a published review can no longer be edited';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_waitlist_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_provider uuid; v_is_family boolean; v_is_coach boolean;
begin
  new.updated_at := now();
  select pr.provider_id into v_provider from public.programs pr where pr.id = new.program_id;
  if v_provider is null then
    if tg_op = 'INSERT' then
      raise exception 'program_waitlist requires a program with a resolvable provider';
    end if;
  else
    new.provider_id := v_provider;
  end if;
  if auth.uid() is null then return new; end if;

  v_is_family := (new.searcher_id = auth.uid());
  v_is_coach  := public.is_program_provider_owner(new.program_id);

  if tg_op = 'INSERT' then
    if not v_is_family then raise exception 'searcher_id must be the authenticated user'; end if;
    if new.status <> 'waiting' then raise exception 'a new waitlist entry must start as waiting'; end if;
    if new.offered_at is not null or new.expires_at is not null then
      raise exception 'offered_at / expires_at are coach-controlled and must be null on join';
    end if;
    return new;
  end if;

  if new.program_id  is distinct from old.program_id
   or new.searcher_id is distinct from old.searcher_id
   or new.athlete_id  is distinct from old.athlete_id
   or new.created_at  is distinct from old.created_at then
    raise exception 'waitlist identity fields (program/searcher/athlete/created_at) are immutable';
  end if;

  if v_is_coach then
    if new.status not in ('waiting','offered','converted','cancelled','expired') then
      raise exception 'invalid waitlist status';
    end if;
    return new;
  end if;

  if v_is_family then
    if new.status not in (old.status, 'cancelled') then
      raise exception 'a family may only withdraw its own waitlist entry';
    end if;
    if new.offered_at is distinct from old.offered_at
     or new.expires_at is distinct from old.expires_at then
      raise exception 'offered_at / expires_at are coach-controlled';
    end if;
    return new;
  end if;

  raise exception 'not authorized to modify this waitlist entry';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_lifecycle_on_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_provider uuid;
begin
  if new.status is distinct from old.status then
    -- Resolve the owning provider from program (or session -> program).
    select pr.provider_id into v_provider
      from public.programs pr where pr.id = new.program_id;
    if v_provider is null and new.session_id is not null then
      select pr.provider_id into v_provider
        from public.sessions s join public.programs pr on pr.id = s.program_id
        where s.id = new.session_id;
    end if;

    if v_provider is not null then
      if new.status = 'confirmed' then
        perform public.enqueue_outbound_message(v_provider, new.athlete_id, new.id, 'booking_confirmed', now());
      elsif new.status = 'completed' then
        perform public.enqueue_outbound_message(v_provider, new.athlete_id, new.id, 'post_session', now());
      elsif new.status = 'no_show' then
        perform public.enqueue_outbound_message(v_provider, new.athlete_id, new.id, 'no_show_followup', now());
      end if;
    end if;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_outbound_message(p_provider_id uuid, p_child_id uuid, p_booking_id uuid, p_event_type text, p_scheduled_for timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  if p_provider_id is null or p_event_type is null then
    return null;
  end if;

  -- WHETHER: the coach turned this lifecycle message off (default 'draft' => on).
  if exists (select 1 from public.lifecycle_message_prefs p
             where p.provider_id = p_provider_id
               and p.event_type = p_event_type
               and p.mode = 'off') then
    return null;
  end if;

  -- Idempotency: never double-enqueue an active row for the same booking+event.
  -- ('skipped' is intentionally excluded — a skipped message may be re-enqueued.)
  if p_booking_id is not null then
    if exists (select 1 from public.outbound_messages o
               where o.booking_id = p_booking_id
                 and o.event_type = p_event_type
                 and o.status in ('pending','drafted','approved','sent')) then
      return null;
    end if;
  end if;

  insert into public.outbound_messages
    (provider_id, child_id, booking_id, event_type, status, scheduled_for)
  values
    (p_provider_id, p_child_id, p_booking_id, p_event_type, 'pending', p_scheduled_for)
  returning id into v_id;
  return v_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_rebook_nudges(p_lapse_days integer DEFAULT 21)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count int := 0; r record; v_id uuid;
begin
  for r in
    select pr.provider_id, b.athlete_id as child_id, max(b.created_at) as last_completed
    from public.bookings b
    join public.programs pr on pr.id = b.program_id
    where b.status = 'completed' and b.athlete_id is not null
    group by pr.provider_id, b.athlete_id
    having max(b.created_at) < now() - make_interval(days => p_lapse_days)
  loop
    -- Skip if anything is upcoming with this coach for this child.
    if exists (
      select 1 from public.bookings b2
      join public.programs pr2 on pr2.id = b2.program_id
      left join public.sessions s2 on s2.id = b2.session_id
      where pr2.provider_id = r.provider_id
        and b2.athlete_id = r.child_id
        and b2.status in ('pending','confirmed')
        and (s2.start_date is null or s2.start_date >= current_date)
    ) then
      continue;
    end if;

    -- Dedup: skip if an active OR recent rebook_nudge already exists for the pair.
    if exists (
      select 1 from public.outbound_messages o
      where o.provider_id = r.provider_id
        and o.child_id = r.child_id
        and o.event_type = 'rebook_nudge'
        and (o.status in ('pending','drafted','approved')
             or o.created_at > now() - make_interval(days => p_lapse_days))
    ) then
      continue;
    end if;

    v_id := public.enqueue_outbound_message(r.provider_id, r.child_id, null, 'rebook_nudge', now());
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $function$
;
CREATE OR REPLACE FUNCTION public.enqueue_reminders_24h()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count int := 0; r record; v_start timestamptz; v_id uuid;
begin
  for r in
    select b.id as booking_id, b.athlete_id, pr.provider_id,
           s.start_date, s.start_time, s.timezone
    from public.bookings b
    join public.sessions s on s.id = b.session_id
    join public.programs pr on pr.id = s.program_id
    where b.status = 'confirmed' and b.session_id is not null
  loop
    -- Best-effort instant from (date + display time) in the session's timezone.
    begin
      v_start := (r.start_date::text || ' ' || coalesce(nullif(r.start_time,''),'12:00 PM'))::timestamp
                 at time zone coalesce(nullif(r.timezone,''),'UTC');
    exception when others then
      raise log 'enqueue_reminders_24h: unparseable start for booking % (date=%, time=%, tz=%); using date@UTC',
        r.booking_id, r.start_date, r.start_time, r.timezone;
      v_start := r.start_date::timestamp at time zone 'UTC';
    end;

    if v_start is not null
       and (v_start - interval '24 hours') >= now()
       and (v_start - interval '24 hours') <  now() + interval '1 hour' then
      v_id := public.enqueue_outbound_message(
                r.provider_id, r.athlete_id, r.booking_id, 'reminder_24h', v_start - interval '24 hours');
      if v_id is not null then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end $function$
;
CREATE OR REPLACE FUNCTION public.ensure_provider_conversation(p_provider_owner_id uuid, p_program_id uuid DEFAULT NULL::uuid)
 RETURNS conversations
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.conversations;
begin
  if auth.uid() is null or p_provider_owner_id is null
     or auth.uid() = p_provider_owner_id then
    raise exception 'invalid conversation participants';
  end if;

  if not exists (
    select 1 from public.providers p
     where p.owner_id = p_provider_owner_id and p.status = 'approved'
  ) then
    raise exception 'provider is not available for messaging';
  end if;

  if p_program_id is not null and not exists (
    select 1
      from public.programs pr
      join public.providers p on p.id = pr.provider_id
     where pr.id = p_program_id
       and p.owner_id = p_provider_owner_id
       and pr.status = 'published'
  ) then
    raise exception 'program does not belong to provider';
  end if;

  insert into public.conversations(searcher_id, provider_id, program_id)
  values (auth.uid(), p_provider_owner_id, p_program_id)
  on conflict (searcher_id, provider_id) do update
    set program_id = coalesce(public.conversations.program_id, excluded.program_id)
  returning * into v_row;
  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_provider()
 RETURNS SETOF providers
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select * from public.providers where owner_id = auth.uid();
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  full_name  text := coalesce(new.raw_user_meta_data ->> 'name', '');
  biz_name   text := coalesce(new.raw_user_meta_data ->> 'business_name', '');
  first_tok  text := split_part(full_name, ' ', 1);
  rest_tok   text := btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1));
  the_role   text := case
                       when (new.raw_user_meta_data ->> 'role') in ('searcher', 'provider')
                         then new.raw_user_meta_data ->> 'role'
                       else 'searcher'
                     end;
begin
  insert into public.profiles (id, role, first_name, last_name, email, phone_number)
  values (
    new.id, the_role,
    coalesce(nullif(first_tok, ''), split_part(coalesce(new.email, 'member'), '@', 1), 'Member'),
    nullif(rest_tok, ''), new.email,
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;

  if the_role = 'provider' then
    insert into public.providers (owner_id, business_name)
    values (new.id, coalesce(nullif(biz_name, ''), nullif(full_name, ''), 'My Academy'))
    on conflict (owner_id) do nothing;
  end if;

  return new;
exception
  when others then
    raise log 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.invoke_lifecycle_process()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_url text; v_key text; v_req bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    raise log 'invoke_lifecycle_process: vault secrets project_url/cron_secret not set; skipping tick';
    return;
  end if;
  select net.http_post(
    url     => v_url || '/functions/v1/lifecycle-process',
    headers => jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body    => '{}'::jsonb) into v_req;
  insert into public.cron_http_audit (job_name, request_id) values ('lifecycle-process', v_req);
end $function$
;
CREATE OR REPLACE FUNCTION public.invoke_plan_progress_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_url text; v_key text; r record; v_req bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    raise log 'invoke_plan_progress_sweep: vault secrets not set; skipping tick';
    return;
  end if;
  for r in
    select dp.id as plan_id
    from public.development_plans dp
    join public.athlete_goals g on g.id = dp.goal_id
    where g.status = 'active' and dp.status in ('draft','active')
  loop
    select net.http_post(
      url     => v_url || '/functions/v1/plan-progress',
      headers => jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
      body    => jsonb_build_object('plan_id', r.plan_id)
    ) into v_req;
    insert into public.cron_http_audit (job_name, request_id) values ('plan-progress-sweep', v_req);
  end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.is_booking_party(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.bookings b where b.id = p_booking_id and b.searcher_id = auth.uid()
  ) or exists (
    select 1 from public.bookings b
    left join public.programs prg on prg.id = b.program_id
    left join public.sessions  s   on s.id  = b.session_id
    left join public.programs prs on prs.id = s.program_id
    join public.providers pv on pv.id = coalesce(prg.provider_id, prs.provider_id)
    where b.id = p_booking_id and pv.owner_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_booking_provider_owner(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.bookings b
    left join public.programs prg on prg.id = b.program_id
    left join public.sessions  s   on s.id  = b.session_id
    left join public.programs prs on prs.id = s.program_id
    join public.providers pv on pv.id = coalesce(prg.provider_id, prs.provider_id)
    where b.id = p_booking_id and pv.owner_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_booking_searcher(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.bookings b
                 where b.id = p_booking_id and b.searcher_id = auth.uid());
$function$
;
CREATE OR REPLACE FUNCTION public.is_coach_brought_family(p_searcher uuid, p_provider uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.coach_invites ci
     where ci.provider_id = p_provider and ci.redeemed_by = p_searcher
       and ci.status = 'accepted' and ci.fee_waived = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_market_ready(p_sport text, p_metro text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_min_listings int; v_min_reviews int;
  v_active bigint; v_reviews bigint; v_force boolean;
begin
  -- Admin/staging override wins when explicitly set true (default: no row => normal logic).
  select force_ready into v_force
    from public.market_overrides where sport = p_sport and metro = p_metro;
  if v_force is true then return true; end if;

  select min_active_listings, min_review_signals into v_min_listings, v_min_reviews
    from public.market_readiness_config where id = true;
  v_min_listings := coalesce(v_min_listings, 15);
  v_min_reviews  := coalesce(v_min_reviews, 30);

  select active_bookable_listings, review_signals into v_active, v_reviews
    from public.market_readiness(p_sport, p_metro) limit 1;

  return coalesce(v_active, 0) >= v_min_listings
     and coalesce(v_reviews, 0) >= v_min_reviews;
end $function$
;
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.providers p
                 where p.id = p_org and p.owner_id = auth.uid())
      or exists (select 1 from public.organization_members m
                 where m.organization_id = p_org and m.member_user_id = auth.uid()
                   and m.role in ('owner','admin') and m.is_active);
$function$
;
CREATE OR REPLACE FUNCTION public.is_program_provider_owner(p_program_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.programs pr join public.providers pv on pv.id = pr.provider_id
    where pr.id = p_program_id and pv.owner_id = auth.uid()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.ltad_max_tier(p_age integer, p_maturation text DEFAULT NULL::text, p_skill text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select greatest(0, least(4, t)) from (
    select (
      (case
        when p_age <= 6                 then 0   -- Active Start
        when p_age between 7  and 11    then 1   -- FUNdamentals / Learn to Train (no elite/select)
        when p_age between 12 and 13    then 2   -- early Train to Train
        when p_age between 14 and 15    then 3   -- Train to Train
        when p_age between 16 and 17    then (case when lower(coalesce(p_skill,'')) in ('advanced','elite') then 4 else 3 end)
        else 4                                    -- 18+ : no ceiling
      end)
      + (case
          when p_age between 11 and 16 and p_maturation = 'early' then 1
          when p_age between 11 and 16 and p_maturation = 'late'  then -1
          else 0
        end)
    ) as t
  ) q;
$function$
;
CREATE OR REPLACE FUNCTION public.maintain_program_enrolled_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new uuid := case when tg_op in ('INSERT','UPDATE') then new.program_id end;
  v_old uuid := case when tg_op in ('UPDATE','DELETE') then old.program_id end;
  v_pid uuid;
begin
  perform set_config('sporve.derived_write','1', true);   -- true = transaction-local
  for v_pid in
    select distinct pid from unnest(array[v_new, v_old]) as t(pid) where pid is not null
  loop
    update public.programs p
       set enrolled_count = (
         select count(*)::int from public.bookings b
          where b.program_id = v_pid and b.status in ('pending','confirmed'))
     where p.id = v_pid;
  end loop;
  perform set_config('sporve.derived_write','0', true);
  return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.market_readiness(p_sport text DEFAULT NULL::text, p_metro text DEFAULT NULL::text)
 RETURNS TABLE(sport text, metro text, active_bookable_listings bigint, review_signals bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with listings as (
    select
      pr.sport_type as sport,
      public.metro_key(pr.latitude, pr.longitude, pr.city, pr.state) as metro,
      pr.total_reviews as reviews,
      exists (
        select 1 from public.sessions s
        where s.program_id = pr.id
          and s.start_date >= current_date
          and (s.capacity = 0 or s.capacity > (
            select count(*) from public.bookings b
            where b.session_id = s.id and b.status in ('pending', 'confirmed')
          ))
      ) as bookable
    from public.programs pr
    where pr.status = 'published'
  )
  select
    l.sport,
    l.metro,
    count(*) filter (where l.bookable)::bigint as active_bookable_listings,
    coalesce(sum(l.reviews), 0)::bigint        as review_signals
  from listings l
  where (p_sport is null or l.sport = p_sport)
    and (p_metro is null or l.metro = p_metro)
  group by l.sport, l.metro
  order by l.sport, l.metro;
$function$
;
CREATE OR REPLACE FUNCTION public.match_eligible(client jsonb)
 RETURNS TABLE(program_id uuid, provider_id uuid, name text, title text, sport text, intensity_tier integer, age_min integer, age_max integer, price_per_session integer, rating_avg numeric, rating_count integer, distance_km double precision, bio text, credentials text[], coach_years_coaching integer, coach_years_played integer, typical_client jsonb, session_types text[], available_this_week boolean, client_max_tier integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with c as (
    select
      (client->>'athlete_age')::int                          as age,
      nullif(client->>'maturation','')                       as maturation,
      nullif(client->>'sport','')                            as sport,
      nullif(client->>'skill_level','')                      as skill,
      (client->>'lat')::double precision                     as lat,
      (client->>'lng')::double precision                     as lng,
      coalesce((client->>'max_distance_km')::double precision, 40) as max_km,
      (client->>'budget_max_per_session')::int               as budget,
      coalesce(nullif(client->>'session_type_pref',''),'any') as stp
  ),
  mx as (select public.ltad_max_tier((select age from c),(select maturation from c),(select skill from c)) as max_tier)
  select
    pr.id, pv.id, pv.business_name, pr.title, pr.sport_type,
    pr.intensity_tier, pr.minimum_age, pr.maximum_age,
    round(pr.price * 100)::int as price_per_session,   -- spec: cents
    pr.average_rating, pr.total_reviews,
    case when c.lat is not null and c.lng is not null and pr.latitude is not null and pr.longitude is not null
      then 6371 * acos(least(1, greatest(-1,
            cos(radians(c.lat))*cos(radians(pr.latitude))*cos(radians(pr.longitude)-radians(c.lng))
            + sin(radians(c.lat))*sin(radians(pr.latitude)))))
      else null end as distance_km,
    pv.bio, pv.credentials, pv.coach_years_coaching, pv.coach_years_played,
    pr.typical_client, pr.session_types,
    exists (select 1 from public.sessions s
            where s.program_id = pr.id and s.start_date >= current_date
              and s.start_date <= current_date + 7
              and (s.capacity = 0 or s.capacity > (
                select count(*) from public.bookings b
                where b.session_id = s.id and b.status in ('pending','confirmed')))) as available_this_week,
    (select max_tier from mx)
  from public.programs pr
  join public.providers pv on pv.id = pr.provider_id
  cross join c cross join mx
  where pr.status = 'published'
    -- G1 — age-appropriate intensity (unknown intensity fails CLOSED = treat as 4)
    and coalesce(pr.intensity_tier, 4) <= mx.max_tier
    -- G2 — age served (null bounds = serves all)
    and c.age >= coalesce(pr.minimum_age, 0) and c.age <= coalesce(pr.maximum_age, 200)
    -- G3 — sport (program sport OR provider specialization)
    and (c.sport is null
         or lower(pr.sport_type) = lower(c.sport)
         or exists (select 1 from unnest(pv.sports) s where lower(s) = lower(c.sport)))
    -- G4 — distance (must have coords AND be within radius)
    and c.lat is not null and c.lng is not null and pr.latitude is not null and pr.longitude is not null
    and 6371 * acos(least(1, greatest(-1,
          cos(radians(c.lat))*cos(radians(pr.latitude))*cos(radians(pr.longitude)-radians(c.lng))
          + sin(radians(c.lat))*sin(radians(pr.latitude))))) <= c.max_km
    -- G5 — safety (non-negotiable, PER-HUMAN): active account AND a verified
    --      background check on the human who will actually coach the child.
    and pv.account_status = 'active'
    and (
          (pv.provider_type = 'solo'
             and pv.background_check_status = 'verified')
       or (pv.provider_type = 'organization' and pr.assigned_member_id is not null and exists (
             select 1 from public.organization_members m
             where m.id = pr.assigned_member_id and m.organization_id = pv.id
               and m.background_check_status = 'verified' and m.is_active = true))
       or (pv.provider_type = 'organization' and pr.assigned_member_id is null and exists (
             select 1 from public.organization_members m
             where m.organization_id = pv.id
               and m.background_check_status = 'verified' and m.is_active = true))
        )
    -- G6 — budget (cents)
    and (c.budget is null or round(pr.price * 100)::int <= c.budget)
    -- G7 — session type
    and (c.stp = 'any' or c.stp = any(pr.session_types));
$function$
;
CREATE OR REPLACE FUNCTION public.metro_key(p_lat double precision, p_lng double precision, p_city text, p_state text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_lat is not null and p_lng is not null
      then 'geo:' || round((floor(p_lat * 2) / 2)::numeric, 1)::text
                  || ',' || round((floor(p_lng * 2) / 2)::numeric, 1)::text
    when coalesce(nullif(trim(p_city), ''), '') <> ''
      then lower(trim(p_city)) || ',' || lower(coalesce(trim(p_state), ''))
    else 'unknown'
  end
$function$
;
CREATE OR REPLACE FUNCTION public.on_review_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sides int;
begin
  insert into public.review_windows (booking_id) values (new.booking_id)
    on conflict (booking_id) do nothing;
  select count(distinct author_role) into v_sides
    from public.reviews where booking_id = new.booking_id;
  if v_sides >= 2 then
    perform public.publish_review_pair(new.booking_id);
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.outbound_freeze_server_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('request.jwt.claims', true) is null
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' then
    return new;
  end if;

  -- Routing and delivery belong to the worker, never to a client. RLS scopes
  -- rows, not columns, so without this an owner-scoped UPDATE could move a
  -- draft to another provider or claim it had been sent.
  if new.provider_id is distinct from old.provider_id
     or new.booking_id is distinct from old.booking_id
     or new.child_id   is distinct from old.child_id
     or new.event_type is distinct from old.event_type
     or new.sent_at    is distinct from old.sent_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Not allowed to modify delivery or routing fields on a queued message';
  end if;

  -- A coach may approve, skip (reject), or return to drafted. 'sent',
  -- 'pending' and 'processing' are the worker's to set: a client that can
  -- write 'sent' can claim a message was delivered that never left.
  if new.status is distinct from old.status
     and new.status not in ('approved','skipped','drafted') then
    raise exception
      'A coach may approve, skip or redraft a message — not set it to %', new.status;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;

  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.prevent_profile_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then return new;
  end if;
  if current_setting('sporve.role_claim', true) = 'on'
     and old.role = 'searcher' and new.role = 'provider' then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'profile role cannot be changed by the client';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.programs_freeze_server_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if current_setting('request.jwt.claims', true) is null
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role'
     or coalesce(current_setting('sporve.derived_write', true),'0') = '1' then
    return new;
  end if;
  if new.average_rating is distinct from old.average_rating
     or new.total_reviews  is distinct from old.total_reviews
     or new.enrolled_count is distinct from old.enrolled_count then
    raise exception 'Not allowed to modify program rating, review count or enrolment — these are derived by Sporve';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.provider_acceptance_rate(p_provider_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with resp as (
    select b.status from public.bookings b
    left join public.programs prg on prg.id = b.program_id
    left join public.sessions  s   on s.id  = b.session_id
    left join public.programs prs on prs.id = s.program_id
    where coalesce(prg.provider_id, prs.provider_id) = p_provider_id
      and b.provider_responded_at is not null
      and b.status in ('confirmed','completed','no_show','declined')
  )
  select case when count(*) = 0 then null
              else round(count(*) filter (where status <> 'declined')::numeric / count(*), 4) end
  from resp;
$function$
;
CREATE OR REPLACE FUNCTION public.provider_instant_book_eligible(p_provider_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(public.provider_acceptance_rate(p_provider_id) >= 0.90, false)
     and coalesce(public.provider_median_response_seconds(p_provider_id) <= 43200, false)
     and public.provider_is_fresh(p_provider_id, 14)
     and (select count(*) from public.bookings b
          left join public.programs prg on prg.id = b.program_id
          left join public.sessions  s   on s.id  = b.session_id
          left join public.programs prs on prs.id = s.program_id
          where coalesce(prg.provider_id, prs.provider_id) = p_provider_id
            and b.provider_responded_at is not null) >= 10;
$function$
;
CREATE OR REPLACE FUNCTION public.provider_is_fresh(p_provider_id uuid, p_days integer DEFAULT 14)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select pv.last_active_at is null
            or pv.last_active_at >= now() - make_interval(days => p_days)
       from public.providers pv where pv.id = p_provider_id), false);
$function$
;
CREATE OR REPLACE FUNCTION public.provider_median_response_seconds(p_provider_id uuid)
 RETURNS double precision
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select percentile_cont(0.5) within group (
           order by extract(epoch from (b.provider_responded_at - b.created_at)))
  from public.bookings b
  left join public.programs prg on prg.id = b.program_id
  left join public.sessions  s   on s.id  = b.session_id
  left join public.programs prs on prs.id = s.program_id
  where coalesce(prg.provider_id, prs.provider_id) = p_provider_id
    and b.provider_responded_at is not null;
$function$
;
CREATE OR REPLACE FUNCTION public.provider_safety_cleared(p_provider_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.providers pv
    where pv.id = p_provider_id
      and pv.account_status = 'active'
      and (
        (pv.provider_type = 'solo'
           and pv.background_check_status = 'verified'
           and pv.background_check_completed_at is not null)
        or (pv.provider_type = 'organization'
           and exists (select 1 from public.organization_members m
                       where m.organization_id = pv.id
                         and m.background_check_status = 'verified'
                         and m.background_check_completed_at is not null
                         and m.is_active = true))
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.publish_review_pair(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform set_config('sporve.review_publish', 'on', true);
  update public.reviews set published_at = now()
   where booking_id = p_booking_id and published_at is null;
  update public.review_windows set released_at = now()
   where booking_id = p_booking_id and released_at is null;
  perform set_config('sporve.review_publish', 'off', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purge_expired_ai_feedback()
 RETURNS TABLE(comments_cleared bigint, rows_deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cleared bigint;
  deleted bigint;
begin
  update public.ai_feedback
  set comment = null
  where comment is not null
    and created_at < now() - interval '90 days';
  get diagnostics cleared = row_count;

  delete from public.ai_feedback
  where created_at < now() - interval '180 days';
  get diagnostics deleted = row_count;

  return query select cleared, deleted;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.purge_expired_ai_observability()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_deleted bigint;
begin
  delete from public.ai_observability_events
   where occurred_at < clock_timestamp() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.recompute_review_aggregates(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_touched integer;
begin
  with agg as (
    select prog.id,
           coalesce(round(avg(r.rating)::numeric, 1), 0) as avg_rating,
           coalesce(count(r.id), 0)                      as n
      from public.programs prog
      left join public.reviews r
             on r.program_id = prog.id
            and r.published_at is not null
     where prog.id = any(p_ids)
     group by prog.id
  )
  update public.programs p
     set average_rating = agg.avg_rating,
         total_reviews  = agg.n
    from agg
   where p.id = agg.id
     and (p.average_rating is distinct from agg.avg_rating
       or p.total_reviews  is distinct from agg.n);
  get diagnostics v_touched = row_count;
  return v_touched;
end $function$
;
CREATE OR REPLACE FUNCTION public.record_webhook_dead_letter(p_event_id text, p_event_type text, p_payload_sha256 text, p_error text, p_occurred_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.webhook_dead_letter
    (stripe_event_id, event_type, payload_sha256, error_msg, occurred_at)
  values (p_event_id, p_event_type, p_payload_sha256, left(coalesce(p_error,''), 500), p_occurred_at)
  on conflict (stripe_event_id) do update
    set seen_count = public.webhook_dead_letter.seen_count + 1,
        error_msg  = excluded.error_msg,
        resolved_at = null;
end $function$
;
CREATE OR REPLACE FUNCTION public.redeem_coach_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inv public.coach_invites;
begin
  if auth.uid() is null then raise exception 'must be signed in to redeem a coach invite'; end if;
  select * into v_inv from public.coach_invites where token = p_token for update;
  if v_inv.id is null then raise exception 'invalid invite'; end if;
  if v_inv.status <> 'pending' then
    raise exception 'this invite has already been used or is no longer active';
  end if;
  if v_inv.expires_at is not null and now() > v_inv.expires_at then
    perform set_config('sporve.invite_redeem', 'on', true);
    update public.coach_invites set status = 'expired', updated_at = now() where id = v_inv.id;
    perform set_config('sporve.invite_redeem', 'off', true);
    raise exception 'this invite has expired';
  end if;
  if auth.uid() = v_inv.inviter_owner_id then
    raise exception 'a coach cannot redeem their own family invite';
  end if;
  perform set_config('sporve.invite_redeem', 'on', true);
  update public.coach_invites
     set status = 'accepted', redeemed_by = auth.uid(), redeemed_at = now(), updated_at = now()
   where id = v_inv.id;
  perform set_config('sporve.invite_redeem', 'off', true);
  return v_inv.id;
end $function$
;
CREATE OR REPLACE FUNCTION public.release_due_reviews()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; n int := 0;
begin
  if auth.uid() is not null then
    raise exception 'release_due_reviews is service-role only';
  end if;
  for r in select booking_id from public.review_windows
            where released_at is null and now() >= closes_at
  loop
    perform public.publish_review_pair(r.booking_id);
    n := n + 1;
  end loop;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_ai_capacity(p_feature text, p_model text, p_actor_id uuid, p_actor_role text, p_input_summary text, p_reservation_cost_usd numeric, p_minute_limit integer, p_day_limit integer, p_daily_cost_limit_usd numeric, p_minute_feature_scoped boolean DEFAULT false, p_enforce_limits boolean DEFAULT true)
 RETURNS TABLE(audit_id uuid, denial_code text, retry_after_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_now timestamptz;
  v_day_start timestamptz;
  v_minute_calls bigint := 0;
  v_day_calls bigint := 0;
  v_day_cost numeric := 0;
  v_audit_id uuid;
  v_retry_after integer;
begin
  if p_feature is null or char_length(p_feature) not between 1 and 64
    or p_model is null or char_length(p_model) not between 1 and 128
    or p_actor_role is null or char_length(p_actor_role) not between 1 and 64
    or p_input_summary is null or char_length(p_input_summary) not between 1 and 2000
    or p_reservation_cost_usd is null
    or p_reservation_cost_usd < 0 or p_reservation_cost_usd > 100000
    or p_minute_limit is null or p_minute_limit not between 1 and 1000000
    or p_day_limit is null or p_day_limit not between 1 and 1000000
    or p_daily_cost_limit_usd is null
    or p_daily_cost_limit_usd <= 0 or p_daily_cost_limit_usd > 1000000
    or p_minute_feature_scoped is null
    or p_enforce_limits is null
  then
    raise exception using errcode = '22023', message = 'invalid_ai_quota_reservation';
  end if;

  if p_enforce_limits then
    -- A stable actor lock coordinates every feature for the same account. The
    -- null key protects unattributed service calls when a caller elects to
    -- enforce limits for them.
    perform pg_advisory_xact_lock(
      hashtextextended(coalesce(p_actor_id::text, 'service_role'), 0)
    );

    -- Measure the windows after any lock wait. Using the function-entry time
    -- could make a queued request evaluate a stale minute or UTC day.
    v_now := clock_timestamp();
    v_day_start := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

    select count(*)
      into v_minute_calls
      from public.ai_audit_log
     where actor_id is not distinct from p_actor_id
       and created_at >= v_now - interval '1 minute'
       and (not p_minute_feature_scoped or feature = p_feature);

    select count(*), coalesce(sum(greatest(est_cost_usd, 0)), 0)
      into v_day_calls, v_day_cost
      from public.ai_audit_log
     where actor_id is not distinct from p_actor_id
       and created_at >= v_day_start;

    if v_minute_calls >= p_minute_limit then
      return query select null::uuid, 'minute_rate_limit'::text, 60;
      return;
    end if;

    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        (date_trunc('day', v_now at time zone 'UTC') + interval '1 day')
        - (v_now at time zone 'UTC')
      )))::integer
    );

    if v_day_calls >= p_day_limit then
      return query select null::uuid, 'daily_rate_limit'::text, v_retry_after;
      return;
    end if;

    if v_day_cost + p_reservation_cost_usd > p_daily_cost_limit_usd then
      return query select null::uuid, 'daily_cost_limit'::text, v_retry_after;
      return;
    end if;
  else
    v_now := clock_timestamp();
  end if;

  insert into public.ai_audit_log (
    feature,
    model,
    actor_id,
    actor_role,
    input_summary,
    output_summary,
    tokens_in,
    tokens_out,
    est_cost_usd,
    latency_ms,
    created_at
  ) values (
    p_feature,
    p_model,
    p_actor_id,
    p_actor_role,
    p_input_summary,
    'pending request completion; quota reservation',
    0,
    0,
    p_reservation_cost_usd,
    0,
    v_now
  )
  returning id into v_audit_id;

  return query select v_audit_id, null::text, null::integer;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reviews_touch_aggregates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- TG_OP tells us which of NEW/OLD is populated. An UPDATE that moves a
  -- review between programs changes TWO aggregates, so pass both ids; the
  -- array is de-duplicated by the = any() lookup either way.
  if TG_OP = 'INSERT' then
    perform public.recompute_review_aggregates(array[new.program_id]);
  elsif TG_OP = 'DELETE' then
    perform public.recompute_review_aggregates(array[old.program_id]);
  else
    perform public.recompute_review_aggregates(array[new.program_id, old.program_id]);
  end if;
  return null;   -- AFTER trigger: return value is ignored
end $function$
;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.run_ai_data_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  feedback_result record;
  observability_deleted bigint;
begin
  select *
    into feedback_result
    from public.purge_expired_ai_feedback();

  select public.purge_expired_ai_observability()
    into observability_deleted;

  return jsonb_build_object(
    'feedback_comments_cleared', coalesce(feedback_result.comments_cleared, 0),
    'feedback_rows_deleted', coalesce(feedback_result.rows_deleted, 0),
    'observability_rows_deleted', coalesce(observability_deleted, 0)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.search_candidates(constraints jsonb)
 RETURNS TABLE(program_id uuid, price numeric, dist double precision, avail boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with c as (
    select nullif(constraints->>'sport','') as sport,
      (constraints->>'athlete_age')::int as athlete_age,
      (constraints->>'lat')::double precision as lat,
      (constraints->>'lng')::double precision as lng,
      coalesce((constraints->>'within_days')::int, 30) as within_days
  )
  select pr.id, pr.price,
    case when c.lat is not null and c.lng is not null
              and pr.latitude is not null and pr.longitude is not null
      then 3959 * acos(least(1, greatest(-1,
            cos(radians(c.lat))*cos(radians(pr.latitude))*cos(radians(pr.longitude)-radians(c.lng))
            + sin(radians(c.lat))*sin(radians(pr.latitude)))))
      else null end as dist,
    exists (
      select 1 from public.sessions s
      where s.program_id = pr.id
        and s.start_date >= current_date
        and s.start_date <= current_date + c.within_days
        and (s.capacity = 0 or s.capacity > (
          select count(*) from public.bookings b
          where b.session_id = s.id and b.status in ('pending','confirmed')))
    ) as avail
  from public.programs pr cross join c
  where pr.status = 'published'
    and public.provider_safety_cleared(pr.provider_id)
    and (c.sport is null or lower(pr.sport_type) = lower(c.sport))
    and (c.athlete_age is null
         or ((pr.minimum_age is null or c.athlete_age >= pr.minimum_age)
             and (pr.maximum_age is null or c.athlete_age <= pr.maximum_age)));
$function$
;
CREATE OR REPLACE FUNCTION public.search_listings(constraints jsonb, query_embedding text DEFAULT NULL::text)
 RETURNS TABLE(program_id uuid, title text, bio text, specialty text, price numeric, currency text, rating numeric, review_count integer, distance_miles double precision, has_availability boolean, review_excerpts text[], score double precision, sem_score double precision, review_score double precision, keyword_score double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with c as (
    select
      (constraints->>'max_price')::numeric        as max_price,
      (constraints->>'radius_miles')::double precision as radius_miles,
      nullif(constraints->>'query_text','')        as query_text
  ),
  filtered as (
    select cand.program_id, cand.dist
    from public.search_candidates(constraints) cand cross join c
    where cand.avail = true                                  -- HARD: bookable availability
      and (c.max_price is null or cand.price <= c.max_price) -- HARD: price cap
      and (                                                  -- HARD: radius (only if asked)
        c.radius_miles is null
        or (cand.dist is not null and cand.dist <= c.radius_miles)
      )
  ),
  scored as (
    select
      pr.id, pr.title, pv.bio as bio,
      (coalesce(pr.sport_type,'') ||
        case when pr.skill_level is not null then ' · ' || pr.skill_level else '' end) as specialty,
      pr.price, pr.currency, pr.average_rating, pr.total_reviews,
      f.dist,
      -- semantic: cosine similarity 0..1 (0 when either vector is absent)
      case when query_embedding is not null and pr.embedding is not null
        then 1 - (pr.embedding <=> query_embedding::vector) else 0 end as sem,
      -- review quality: rating scaled by a volume-confidence factor (caps at 1)
      least(1, (coalesce(pr.average_rating,0)/5.0) * (ln(coalesce(pr.total_reviews,0)+1)/ln(50))) as revq,
      -- keyword/FTS: ts_rank over descriptive text vs the raw query (no index; fine here)
      case when (select query_text from c) is not null then least(1, 10 * ts_rank(
             to_tsvector('english', coalesce(pr.title,'')||' '||coalesce(pr.description,'')||' '||array_to_string(pr.whats_included,' ')),
             plainto_tsquery('english', (select query_text from c)))) else 0 end as kw
    from filtered f
    join public.programs pr on pr.id = f.program_id
    join public.providers pv on pv.id = pr.provider_id
  )
  select
    s.id, s.title, s.bio, s.specialty,
    s.price, s.currency, s.average_rating, s.total_reviews,
    s.dist, true as has_availability,
    coalesce((
      select array_agg(r.body)
      from (select body from public.reviews rv
            where rv.program_id = s.id and rv.body is not null
            order by rv.created_at desc limit 2) r
    ), '{}'::text[]) as review_excerpts,
    (0.60*s.sem + 0.25*s.revq + 0.15*s.kw) as score,
    s.sem, s.revq, s.kw
  from scored s
  order by score desc, s.average_rating desc nulls last, s.total_reviews desc
  limit 20;
$function$
;
CREATE OR REPLACE FUNCTION public.search_relax(constraints jsonb, p_min_results integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cap numeric := (constraints->>'max_price')::numeric;
  v_radius double precision := (constraints->>'radius_miles')::double precision;
  v_full int;
  v_price_gain int; v_cheapest numeric;
  v_radius_needed double precision; v_radius_gain int;
begin
  -- full result count (all hard constraints applied)
  select count(*) into v_full
  from public.search_candidates(constraints) cand
  where cand.avail
    and (v_cap is null or cand.price <= v_cap)
    and (v_radius is null or (cand.dist is not null and cand.dist <= v_radius));
  if v_full >= p_min_results then
    return jsonb_build_object('relax', null, 'results', v_full);
  end if;

  -- PRICE relax: cheapest listing just over the cap (radius still applied).
  if v_cap is not null then
    select min(price), count(*) into v_cheapest, v_price_gain
    from public.search_candidates(constraints) cand
    where cand.avail and cand.price > v_cap
      and (v_radius is null or (cand.dist is not null and cand.dist <= v_radius));
  end if;

  -- RADIUS relax: the radius needed to reach p_min_results (price still applied).
  if v_radius is not null then
    select dist into v_radius_needed from (
      select cand.dist
      from public.search_candidates(constraints) cand
      where cand.avail and cand.dist is not null and cand.dist > v_radius
        and (v_cap is null or cand.price <= v_cap)
      order by cand.dist
      offset greatest(0, p_min_results - v_full - 1) limit 1
    ) q;
    select count(*) into v_radius_gain
    from public.search_candidates(constraints) cand
    where cand.avail and cand.dist is not null and cand.dist <= coalesce(v_radius_needed, v_radius)
      and (v_cap is null or cand.price <= v_cap);
  end if;

  -- Pick the SINGLE CHEAPEST constraint to relax, measured as the smallest
  -- RELATIVE stretch from what the parent asked for (price % over cap vs radius
  -- % over the asked radius). Whichever is the smaller change wins.
  declare
    price_cost double precision := case when v_cheapest is not null and v_cap > 0
                                        then (v_cheapest - v_cap) / v_cap else null end;
    radius_cost double precision := case when v_radius_needed is not null and v_radius > 0
                                         then (v_radius_needed - v_radius) / v_radius else null end;
  begin
    -- Budget is the stickiest constraint: prefer expanding radius (which keeps
    -- the parent WITHIN their price cap) unless raising price is clearly cheaper
    -- (radius gets a 2x cost advantage so we never suggest blowing the budget
    -- over a marginal stretch). Only suggest price when widening can't help.
    if radius_cost is not null and (price_cost is null or radius_cost <= 2 * price_cost) then
      return jsonb_build_object(
        'relax', 'radius', 'results', v_full,
        'radius_needed_miles', ceil(v_radius_needed),
        'options_if_relaxed', coalesce(v_radius_gain,0),
        'message', format('Expand your radius to %s mi for %s option(s).',
                          ceil(v_radius_needed)::text, coalesce(v_radius_gain,0)));
    elsif v_cheapest is not null then  -- price the cheaper (or only) lever
      return jsonb_build_object(
        'relax', 'price', 'results', v_full,
        'cheapest_over_cap', v_cheapest,
        'options_if_relaxed', coalesce(v_price_gain,0) + v_full,
        'message', format('The nearest match is $%s. Raise your max to $%s for %s option(s).',
                          round(v_cheapest)::text, round(v_cheapest)::text, coalesce(v_price_gain,0) + v_full));
    else
      return jsonb_build_object('relax', 'broaden', 'results', v_full,
        'message', 'No matches with these constraints. Try a different sport, age, or location.');
    end if;
  end;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_booking_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base numeric := 0;
  mult numeric := 1;
begin
  select price into base from public.programs where id = new.program_id;
  base := coalesce(base, 0);
  mult := case upper(coalesce(new.selected_tier, ''))
            when 'PRO' then 1.6
            when 'ELITE' then 2.6
            else 1
          end;
  new.original_price := round(base, 2);
  new.final_price := round(base * mult, 2);
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.snapshot_booking_cancellation_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  select cancellation_policy into new.cancellation_policy_snapshot
    from public.programs where id = new.program_id;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sporve_link_booking_to_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.plan_proposal_id is not null then
    update public.plan_proposals pp
      set status = case when pp.status = 'proposed' then 'accepted' else pp.status end,
          resulting_booking_id = new.id,
          responded_at = coalesce(pp.responded_at, now())
      where pp.id = new.plan_proposal_id
        and exists (
          select 1 from public.development_plans dp
          join public.athlete_goals g on g.id = dp.goal_id
          join public.athletes a on a.id = g.athlete_id
          where dp.id = pp.plan_id and a.parent_id = new.searcher_id);
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sporve_plan_proposals_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_user <> 'authenticated' then
    return new;  -- service_role / admin backends (the concierge) bypass
  end if;
  if new.status not in ('accepted','declined') then
    raise exception 'Sporve: parents may only set proposal status to accepted or declined';
  end if;
  if (new.plan_id, new.proposal_type, new.service_id, new.provider_id,
      new.reason_text, new.rank, new.resulting_booking_id, new.created_at)
     is distinct from
     (old.plan_id, old.proposal_type, old.service_id, old.provider_id,
      old.reason_text, old.rank, old.resulting_booking_id, old.created_at) then
    raise exception 'Sporve: parents may only update proposal status';
  end if;
  new.responded_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.sporve_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.stamp_booking_provider_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_provider uuid;
begin
  if old.status = 'pending' and new.status <> 'pending' and new.provider_responded_at is null then
    new.provider_responded_at := now();
    if new.program_id is not null then
      select pr.provider_id into v_provider from public.programs pr where pr.id = new.program_id;
    elsif new.session_id is not null then
      select pr.provider_id into v_provider
        from public.sessions s join public.programs pr on pr.id = s.program_id where s.id = new.session_id;
    end if;
    if v_provider is not null then
      update public.providers set last_active_at = now() where id = v_provider;
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.stamp_provider_activation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.background_check_status = 'verified' and new.verified_at is null then
      new.verified_at := now();
    end if;
    if coalesce(new.stripe_charges_enabled, false) and new.payout_enabled_at is null then
      new.payout_enabled_at := now();
    end if;
  elsif tg_op = 'UPDATE' then
    if new.background_check_status = 'verified'
       and old.background_check_status is distinct from 'verified'
       and new.verified_at is null then
      new.verified_at := now();
    end if;
    if coalesce(new.stripe_charges_enabled, false)
       and not coalesce(old.stripe_charges_enabled, false)
       and new.payout_enabled_at is null then
      new.payout_enabled_at := now();
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.stamp_provider_first_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_provider uuid;
begin
  if new.payment_status is distinct from 'paid' then
    return new;
  end if;
  if new.program_id is not null then
    select pr.provider_id into v_provider from public.programs pr where pr.id = new.program_id;
  elsif new.session_id is not null then
    select pr.provider_id into v_provider
      from public.sessions s join public.programs pr on pr.id = s.program_id
      where s.id = new.session_id;
  end if;
  if v_provider is not null then
    update public.providers set first_booking_at = now()
      where id = v_provider and first_booking_at is null;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_ai_feedback(p_actor_hash text, p_feature text, p_feature_version text, p_category text, p_helpfulness text, p_comment text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  inserted_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_hash, 0));

  if (
    select count(*)
    from public.ai_feedback
    where actor_hash = p_actor_hash
      and created_at >= now() - interval '1 hour'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'feedback_rate_limited';
  end if;

  insert into public.ai_feedback (
    actor_hash,
    feature,
    feature_version,
    category,
    helpfulness,
    comment
  ) values (
    p_actor_hash,
    p_feature,
    p_feature_version,
    p_category,
    p_helpfulness,
    nullif(btrim(p_comment), '')
  )
  returning id into inserted_id;

  return inserted_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_safety_report(p_provider_id uuid, p_category text, p_details text, p_booking_id uuid DEFAULT NULL::uuid, p_conversation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_id uuid;
  v_actor uuid := auth.uid();
  v_allowed boolean;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_category not in ('unsafe_behavior','harassment','discrimination',
      'identity_concern','inappropriate_content','payment_dispute','other') then
    raise exception 'invalid report category';
  end if;
  if char_length(trim(coalesce(p_details,''))) not between 10 and 4000 then
    raise exception 'details must be 10 to 4000 characters';
  end if;
  if p_provider_id is null and p_booking_id is null and p_conversation_id is null then
    raise exception 'a report target is required';
  end if;

  select public.consume_edge_rate_limit(
    'user:' || v_actor::text, 'safety-report:day', 10, 86400
  ) into v_allowed;
  if not v_allowed then raise exception 'safety report limit reached'; end if;

  if p_booking_id is not null and not exists (
    select 1 from public.bookings b
     where b.id = p_booking_id and b.searcher_id = v_actor
  ) then
    raise exception 'booking is not visible to reporter';
  end if;
  if p_conversation_id is not null and not exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and v_actor in (c.searcher_id, c.provider_id)
  ) then
    raise exception 'conversation is not visible to reporter';
  end if;
  if p_provider_id is not null and not exists (
    select 1 from public.providers p where p.id = p_provider_id
  ) then
    raise exception 'provider does not exist';
  end if;

  insert into public.safety_reports(
    reporter_id, provider_id, booking_id, conversation_id, category, details
  ) values (
    v_actor, p_provider_id, p_booking_id, p_conversation_id,
    p_category, trim(p_details)
  ) returning id into v_id;
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_public_coords()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Public coordinates are DERIVED, never client-set. Rounding to 2 decimal
  -- places is ~1.1km of latitude, enough to place a map pin in the right
  -- neighbourhood without disclosing a coach's home address.
  if new.latitude is null or new.longitude is null then
    new.public_latitude  := null;
    new.public_longitude := null;
  else
    new.public_latitude  := round(new.latitude::numeric, 2)::double precision;
    new.public_longitude := round(new.longitude::numeric, 2)::double precision;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_lifecycle_prefs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.touch_provider_activity()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then return; end if;
  update public.providers set last_active_at = now() where owner_id = auth.uid();
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_progress_digest_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from public.progress_digests d
    join public.session_notes n on n.id = new.session_note_id
    where d.id = new.digest_id and n.child_id = d.athlete_id
  ) then
    raise exception 'progress source must belong to the digest athlete';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_token text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Constant-time-ish: compare digests, not raw strings, so length and early
  -- byte differences do not leak through timing.
  select exists (
    select 1 from vault.decrypted_secrets
     where name = 'cron_secret'
       and extensions.digest(decrypted_secret, 'sha256') = extensions.digest(coalesce(p_token,''), 'sha256')
  );
$function$
;

-- ------------------------------------------------------------ views (10)
CREATE OR REPLACE VIEW public.market_readiness_overview AS
 SELECT m.sport,
    m.metro,
    m.active_bookable_listings,
    m.review_signals,
    c.min_active_listings,
    c.min_review_signals,
    is_market_ready(m.sport, m.metro) AS ready,
    COALESCE(o.force_ready, false) AS force_ready
   FROM market_readiness() m(sport, metro, active_bookable_listings, review_signals)
     CROSS JOIN market_readiness_config c
     LEFT JOIN market_overrides o ON o.sport = m.sport AND o.metro = m.metro
  WHERE c.id = true;
CREATE OR REPLACE VIEW public.ai_ops_hourly WITH (security_invoker=true) AS
 SELECT date_trunc('hour'::text, occurred_at) AS bucket_start,
    function_name,
    feature,
    count(*) FILTER (WHERE event_type = 'request_completed'::text) AS requests,
    count(*) FILTER (WHERE event_type = 'request_completed'::text AND http_status >= 400 AND http_status <= 499) AS http_4xx,
    count(*) FILTER (WHERE event_type = 'request_completed'::text AND http_status >= 500 AND http_status <= 599) AS http_5xx,
    count(*) FILTER (WHERE event_type = 'provider_call'::text) AS provider_calls,
    count(*) FILTER (WHERE event_type = 'provider_call'::text AND outcome = 'error'::text) AS provider_errors,
    count(*) FILTER (WHERE event_type = 'provider_call'::text AND outcome = 'timeout'::text) AS provider_timeouts,
    count(*) FILTER (WHERE event_type = 'quota_denied'::text) AS quota_denials,
    count(*) FILTER (WHERE event_type = 'request_completed'::text AND fallback_used) AS fallbacks,
    count(*) FILTER (WHERE event_type = 'request_completed'::text AND (grounding_status = ANY (ARRAY['unavailable'::text, 'invalid_selection'::text]))) AS grounding_failures,
    percentile_cont(0.50::double precision) WITHIN GROUP (ORDER BY (latency_ms::double precision)) FILTER (WHERE event_type = 'provider_call'::text AND latency_ms IS NOT NULL) AS provider_latency_p50_ms,
    percentile_cont(0.95::double precision) WITHIN GROUP (ORDER BY (latency_ms::double precision)) FILTER (WHERE event_type = 'provider_call'::text AND latency_ms IS NOT NULL) AS provider_latency_p95_ms,
    percentile_cont(0.99::double precision) WITHIN GROUP (ORDER BY (latency_ms::double precision)) FILTER (WHERE event_type = 'provider_call'::text AND latency_ms IS NOT NULL) AS provider_latency_p99_ms,
    COALESCE(sum(tokens_in) FILTER (WHERE event_type = 'provider_call'::text), 0::numeric) AS tokens_in,
    COALESCE(sum(tokens_out) FILTER (WHERE event_type = 'provider_call'::text), 0::numeric) AS tokens_out,
    COALESCE(sum(est_cost_usd) FILTER (WHERE event_type = 'provider_call'::text), 0::numeric) AS est_cost_usd
   FROM ai_observability_events
  GROUP BY (date_trunc('hour'::text, occurred_at)), function_name, feature;
CREATE OR REPLACE VIEW public.ai_ops_feedback_daily WITH (security_invoker=true) AS
 SELECT date_trunc('day'::text, created_at) AS bucket_start,
    feature,
    count(*) AS responses,
    count(*) FILTER (WHERE helpfulness = 'yes'::text) AS helpful,
    count(*) FILTER (WHERE helpfulness = 'partly'::text) AS partly_helpful,
    count(*) FILTER (WHERE helpfulness = 'no'::text) AS not_helpful,
    count(*) FILTER (WHERE category = 'accuracy'::text) AS accuracy,
    count(*) FILTER (WHERE category = 'stale_listing'::text) AS stale_listing,
    count(*) FILTER (WHERE category = 'safety'::text) AS safety,
    count(*) FILTER (WHERE category = 'technical'::text) AS technical
   FROM ai_feedback
  GROUP BY (date_trunc('day'::text, created_at)), feature;
CREATE OR REPLACE VIEW public.ai_ops_alerts WITH (security_invoker=true) AS
 WITH recent AS (
         SELECT ai_observability_events.id,
            ai_observability_events.request_id,
            ai_observability_events.audit_id,
            ai_observability_events.occurred_at,
            ai_observability_events.function_name,
            ai_observability_events.feature,
            ai_observability_events.event_type,
            ai_observability_events.outcome,
            ai_observability_events.provider,
            ai_observability_events.http_status,
            ai_observability_events.provider_status,
            ai_observability_events.latency_ms,
            ai_observability_events.tokens_in,
            ai_observability_events.tokens_out,
            ai_observability_events.est_cost_usd,
            ai_observability_events.fallback_used,
            ai_observability_events.grounding_status,
            ai_observability_events.error_code
           FROM ai_observability_events
          WHERE ai_observability_events.occurred_at >= (clock_timestamp() - '24:00:00'::interval)
        ), feedback_recent AS (
         SELECT ai_feedback.helpfulness,
            ai_feedback.category
           FROM ai_feedback
          WHERE ai_feedback.created_at >= (clock_timestamp() - '24:00:00'::interval)
        ), measurements AS (
         SELECT 'provider_error_rate'::text AS metric,
            COALESCE(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text AND recent.outcome = 'error'::text)::numeric / NULLIF(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text), 0)::numeric, 0::numeric) AS observed_value,
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text)::integer AS sample_size
           FROM recent
        UNION ALL
         SELECT 'provider_timeout_rate'::text,
            COALESCE(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text AND recent.outcome = 'timeout'::text)::numeric / NULLIF(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text), 0)::numeric, 0::numeric) AS "coalesce",
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'fallback_rate'::text,
            COALESCE(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.function_name = 'chat-answer'::text AND recent.event_type = 'request_completed'::text AND recent.fallback_used)::numeric / NULLIF(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.function_name = 'chat-answer'::text AND recent.event_type = 'request_completed'::text), 0)::numeric, 0::numeric) AS "coalesce",
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.function_name = 'chat-answer'::text AND recent.event_type = 'request_completed'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'quota_denials_count'::text,
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'quota_denied'::text)::numeric AS count,
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'grounding_failures_count'::text,
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text AND (recent.grounding_status = ANY (ARRAY['unavailable'::text, 'invalid_selection'::text])))::numeric AS count,
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text AND recent.grounding_status <> 'not_applicable'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'p95_provider_latency_ms'::text,
            COALESCE(percentile_cont(0.95::double precision) WITHIN GROUP (ORDER BY (recent.latency_ms::double precision)) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text AND recent.latency_ms IS NOT NULL), 0::double precision)::numeric AS "coalesce",
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'provider_call'::text AND recent.latency_ms IS NOT NULL)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'http_4xx_rate'::text,
            COALESCE(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text AND recent.http_status >= 400 AND recent.http_status <= 499)::numeric / NULLIF(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text), 0)::numeric, 0::numeric) AS "coalesce",
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'http_5xx_rate'::text,
            COALESCE(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text AND recent.http_status >= 500 AND recent.http_status <= 599)::numeric / NULLIF(count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text), 0)::numeric, 0::numeric) AS "coalesce",
            count(*) FILTER (WHERE recent.occurred_at >= (clock_timestamp() - '00:15:00'::interval) AND recent.event_type = 'request_completed'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'daily_cost_usd'::text,
            COALESCE(sum(recent.est_cost_usd) FILTER (WHERE recent.event_type = 'provider_call'::text), 0::numeric) AS "coalesce",
            count(*) FILTER (WHERE recent.event_type = 'provider_call'::text)::integer AS count
           FROM recent
        UNION ALL
         SELECT 'negative_feedback_rate'::text,
            COALESCE(count(*) FILTER (WHERE feedback_recent.helpfulness = 'no'::text)::numeric / NULLIF(count(*), 0)::numeric, 0::numeric) AS "coalesce",
            count(*)::integer AS count
           FROM feedback_recent
        UNION ALL
         SELECT 'unsafe_feedback_count'::text,
            count(*) FILTER (WHERE feedback_recent.category = 'safety'::text)::numeric AS count,
            count(*)::integer AS count
           FROM feedback_recent
        )
 SELECT measurements.metric,
    thresholds.window_minutes,
    measurements.observed_value,
    thresholds.warning_threshold,
    thresholds.critical_threshold,
    measurements.sample_size,
    thresholds.min_sample_size,
        CASE
            WHEN NOT thresholds.enabled THEN 'disabled'::text
            WHEN measurements.sample_size < thresholds.min_sample_size THEN 'insufficient_data'::text
            WHEN measurements.observed_value >= thresholds.critical_threshold THEN 'critical'::text
            WHEN measurements.observed_value >= thresholds.warning_threshold THEN 'warning'::text
            ELSE 'ok'::text
        END AS status,
    thresholds.description
   FROM measurements
     JOIN ai_alert_thresholds thresholds USING (metric);
CREATE OR REPLACE VIEW public.provider_booking_operations WITH (security_invoker=true) AS
 SELECT b.id,
    b.session_id,
    b.program_id,
    p.title AS program_title,
    b.athlete_first_name,
    b.athlete_age_band,
    b.selected_tier,
    b.final_price,
    b.currency,
    b.status,
    b.payment_status,
    b.refund_amount,
    b.cancellation_policy_snapshot,
    b.created_at,
    b.cancelled_at,
    b.refunded_at,
    s.start_date,
    s.start_time,
    s.end_time
   FROM bookings b
     LEFT JOIN programs p ON p.id = b.program_id
     LEFT JOIN sessions s ON s.id = b.session_id;
CREATE OR REPLACE VIEW public.repeat_booking_stats WITH (security_invoker=true) AS
 WITH paid AS (
         SELECT b.searcher_id,
            COALESCE(pr1.provider_id, pr2.provider_id) AS provider_id
           FROM bookings b
             LEFT JOIN programs pr1 ON pr1.id = b.program_id
             LEFT JOIN sessions s ON s.id = b.session_id
             LEFT JOIN programs pr2 ON pr2.id = s.program_id
          WHERE b.payment_status = 'paid'::text
        ), pairs AS (
         SELECT paid.searcher_id,
            paid.provider_id,
            count(*) AS paid_bookings
           FROM paid
          WHERE paid.provider_id IS NOT NULL
          GROUP BY paid.searcher_id, paid.provider_id
        )
 SELECT count(DISTINCT searcher_id) AS families_with_paid_booking,
    count(DISTINCT searcher_id) FILTER (WHERE paid_bookings >= 3) AS repeat_families,
        CASE
            WHEN count(DISTINCT searcher_id) > 0 THEN round(count(DISTINCT searcher_id) FILTER (WHERE paid_bookings >= 3)::numeric / count(DISTINCT searcher_id)::numeric, 4)
            ELSE 0::numeric
        END AS repeat_booking_rate
   FROM pairs;
CREATE OR REPLACE VIEW public.coach_activation_funnel WITH (security_invoker=true) AS
 SELECT id AS provider_id,
    provider_type,
    created_at AS signed_up_at,
    verified_at,
    payout_enabled_at,
    first_booking_at,
    verified_at IS NOT NULL AS is_verified,
    payout_enabled_at IS NOT NULL AS is_payout_enabled,
    first_booking_at IS NOT NULL AS has_first_booking,
        CASE
            WHEN verified_at IS NOT NULL THEN round(EXTRACT(epoch FROM verified_at - created_at) / 86400.0, 2)
            ELSE NULL::numeric
        END AS days_signup_to_verified,
        CASE
            WHEN payout_enabled_at IS NOT NULL AND verified_at IS NOT NULL THEN round(EXTRACT(epoch FROM payout_enabled_at - verified_at) / 86400.0, 2)
            ELSE NULL::numeric
        END AS days_verified_to_payout,
        CASE
            WHEN first_booking_at IS NOT NULL AND payout_enabled_at IS NOT NULL THEN round(EXTRACT(epoch FROM first_booking_at - payout_enabled_at) / 86400.0, 2)
            ELSE NULL::numeric
        END AS days_payout_to_first_booking,
        CASE
            WHEN first_booking_at IS NOT NULL THEN round(EXTRACT(epoch FROM first_booking_at - created_at) / 86400.0, 2)
            ELSE NULL::numeric
        END AS days_signup_to_first_booking
   FROM providers pv;
CREATE OR REPLACE VIEW public.stale_providers WITH (security_invoker=true) AS
 SELECT id AS provider_id,
    business_name,
    last_active_at,
    round(EXTRACT(epoch FROM now() - last_active_at) / 86400.0, 1) AS days_inactive
   FROM providers pv
  WHERE account_status = 'active'::text AND status = 'approved'::text AND last_active_at IS NOT NULL AND last_active_at < (now() - '14 days'::interval) AND (EXISTS ( SELECT 1
           FROM programs pr
          WHERE pr.provider_id = pv.id AND pr.status = 'published'::text));
CREATE OR REPLACE VIEW public.cron_http_health AS
 SELECT job_name,
    count(*) AS attempts_24h,
    count(*) FILTER (WHERE status_code >= 200 AND status_code <= 299) AS ok,
    count(*) FILTER (WHERE status_code IS NOT NULL AND (status_code < 200 OR status_code >= 300)) AS failed,
    count(*) FILTER (WHERE checked_at IS NULL) AS pending,
    round(100.0 * count(*) FILTER (WHERE status_code >= 200 AND status_code <= 299)::numeric / NULLIF(count(*) FILTER (WHERE checked_at IS NOT NULL), 0)::numeric, 1) AS success_pct,
    max(queued_at) AS last_attempt,
    (array_agg(error_msg ORDER BY queued_at DESC) FILTER (WHERE error_msg IS NOT NULL))[1] AS latest_error,
    count(*) FILTER (WHERE checked_at IS NOT NULL AND status_code IS NULL) AS timed_out
   FROM cron_http_audit
  WHERE queued_at > (now() - '24:00:00'::interval)
  GROUP BY job_name;
CREATE OR REPLACE VIEW public.cron_latest_status WITH (security_invoker=true) AS
 SELECT DISTINCT ON (job_name) job_name,
    status_code,
    queued_at,
    error_msg
   FROM cron_http_audit ca
  WHERE status_code IS NOT NULL
  ORDER BY job_name, queued_at DESC;

-- ------------------------------------------------------------ indexes (90)
CREATE INDEX IF NOT EXISTS ai_feedback_actor_created_idx ON public.ai_feedback USING btree (actor_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_feedback_feature_created_idx ON public.ai_feedback USING btree (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_observability_events_audit_id_idx ON public.ai_observability_events USING btree (audit_id) WHERE (audit_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS ai_observability_events_function_feature_time_idx ON public.ai_observability_events USING btree (function_name, feature, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_observability_events_occurred_at_idx ON public.ai_observability_events USING btree (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_observability_events_request_id_idx ON public.ai_observability_events USING btree (request_id);
CREATE INDEX IF NOT EXISTS ai_observability_events_type_time_idx ON public.ai_observability_events USING btree (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_provider_used_idx ON public.ai_usage USING btree (provider_id, used_at);
CREATE INDEX IF NOT EXISTS athlete_goals_athlete_idx ON public.athlete_goals USING btree (athlete_id);
CREATE INDEX IF NOT EXISTS athlete_goals_created_by_idx ON public.athlete_goals USING btree (created_by);
CREATE INDEX IF NOT EXISTS billing_subscriptions_provider_idx ON public.billing_subscriptions USING btree (provider_id);
CREATE INDEX IF NOT EXISTS bookings_plan_proposal_idx ON public.bookings USING btree (plan_proposal_id);
CREATE INDEX IF NOT EXISTS development_plans_goal_idx ON public.development_plans USING btree (goal_id);
CREATE INDEX IF NOT EXISTS edge_rate_limits_window_start_idx ON public.edge_rate_limits USING btree (window_start);
CREATE INDEX IF NOT EXISTS facility_notes_facility_idx ON public.facility_notes USING btree (facility_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_actor ON public.ai_audit_log USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_actor_created ON public.ai_audit_log USING btree (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_actor_feature_created ON public.ai_audit_log USING btree (actor_id, feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_created ON public.ai_audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_feature ON public.ai_audit_log USING btree (feature);
CREATE INDEX IF NOT EXISTS idx_athletes_parent ON public.athletes USING btree (parent_id);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_member ON public.bookings USING btree (assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_bookings_searcher ON public.bookings USING btree (searcher_id);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON public.bookings USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_coach_agent_turns_coach ON public.coach_agent_turns USING btree (coach_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_agent_turns_org ON public.coach_agent_turns USING btree (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_invites_provider ON public.coach_invites USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_coach_invites_redeemer ON public.coach_invites USING btree (redeemed_by);
CREATE INDEX IF NOT EXISTS idx_conversations_provider ON public.conversations USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_conversations_searcher ON public.conversations USING btree (searcher_id);
CREATE INDEX IF NOT EXISTS idx_cron_http_audit_recent ON public.cron_http_audit USING btree (job_name, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_http_audit_unchecked ON public.cron_http_audit USING btree (queued_at) WHERE (checked_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_disputes_booking ON public.disputes USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_disputes_opener ON public.disputes USING btree (opener_id);
CREATE INDEX IF NOT EXISTS idx_disputes_queue ON public.disputes USING btree (status, created_at);
CREATE INDEX IF NOT EXISTS idx_lmp_provider ON public.lifecycle_message_prefs USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_bookable ON public.organization_members USING btree (organization_id) WHERE ((background_check_status = 'verified'::text) AND (is_active = true));
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members USING btree (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members USING btree (member_user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_booking ON public.outbound_messages USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_outbound_child ON public.outbound_messages USING btree (child_id);
CREATE INDEX IF NOT EXISTS idx_outbound_provider ON public.outbound_messages USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_outbound_scheduled ON public.outbound_messages USING btree (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON public.outbound_messages USING btree (status);
CREATE INDEX IF NOT EXISTS idx_parent_updates_child ON public.parent_updates USING btree (child_id);
CREATE INDEX IF NOT EXISTS idx_parent_updates_note ON public.parent_updates USING btree (session_note_id);
CREATE INDEX IF NOT EXISTS idx_parent_updates_provider ON public.parent_updates USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_parent_updates_status ON public.parent_updates USING btree (status);
CREATE INDEX IF NOT EXISTS idx_program_waitlist_program ON public.program_waitlist USING btree (program_id, created_at);
CREATE INDEX IF NOT EXISTS idx_program_waitlist_provider ON public.program_waitlist USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_program_waitlist_searcher ON public.program_waitlist USING btree (searcher_id);
CREATE INDEX IF NOT EXISTS idx_programs_assigned_member ON public.programs USING btree (assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_programs_embedding ON public.programs USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_programs_provider ON public.programs USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_providers_last_active ON public.providers USING btree (last_active_at);
CREATE INDEX IF NOT EXISTS idx_providers_owner ON public.providers USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_review_windows_due ON public.review_windows USING btree (closes_at) WHERE (released_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_reviews_booking ON public.reviews USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_program ON public.reviews USING btree (program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_published ON public.reviews USING btree (program_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_parse_cache_created ON public.search_parse_cache USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_notes_booking ON public.session_notes USING btree (booking_id);
CREATE INDEX IF NOT EXISTS idx_session_notes_child ON public.session_notes USING btree (child_id);
CREATE INDEX IF NOT EXISTS idx_session_notes_provider ON public.session_notes USING btree (provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_assigned_member ON public.sessions USING btree (assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_program ON public.sessions USING btree (program_id);
CREATE INDEX IF NOT EXISTS idx_team_athletes_athlete ON public.team_athletes USING btree (athlete_id);
CREATE INDEX IF NOT EXISTS idx_team_athletes_team ON public.team_athletes USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_teams_provider ON public.teams USING btree (provider_id);
CREATE INDEX IF NOT EXISTS payment_event_ledger_booking_idx ON public.payment_event_ledger USING btree (booking_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS plan_proposals_booking_idx ON public.plan_proposals USING btree (resulting_booking_id);
CREATE INDEX IF NOT EXISTS plan_proposals_plan_idx ON public.plan_proposals USING btree (plan_id);
CREATE INDEX IF NOT EXISTS plan_proposals_status_idx ON public.plan_proposals USING btree (plan_id, status);
CREATE INDEX IF NOT EXISTS program_fixtures_program_idx ON public.program_fixtures USING btree (program_id, starts_at);
CREATE INDEX IF NOT EXISTS progress_digests_athlete_idx ON public.progress_digests USING btree (athlete_id);
CREATE INDEX IF NOT EXISTS progress_digests_plan_idx ON public.progress_digests USING btree (plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS safety_reports_queue_idx ON public.safety_reports USING btree (status, priority, created_at);
CREATE INDEX IF NOT EXISTS staff_certifications_member_idx ON public.staff_certifications USING btree (member_user_id);
CREATE INDEX IF NOT EXISTS staff_certifications_org_idx ON public.staff_certifications USING btree (organization_id);
CREATE INDEX IF NOT EXISTS waitlist_rate_limit_ip_ts_idx ON public.waitlist_rate_limit USING btree (ip, ts);
CREATE UNIQUE INDEX IF NOT EXISTS athlete_goals_one_active_per_sport ON public.athlete_goals USING btree (athlete_id, sport) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_searcher_provider_unique ON public.conversations USING btree (searcher_id, provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_open_per_booking ON public.disputes USING btree (booking_id) WHERE (status = ANY (ARRAY['open'::text, 'awaiting_counterparty'::text, 'under_review'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_invites_token ON public.coach_invites USING btree (token);
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_open_per_booking ON public.refund_requests USING btree (booking_id) WHERE (status = ANY (ARRAY['submitted'::text, 'reviewing'::text, 'approved'::text, 'processing'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_booking_side ON public.reviews USING btree (booking_id, author_role) WHERE (booking_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_lower_idx ON public.waitlist USING btree (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS webhook_dead_letter_event_idx ON public.webhook_dead_letter USING btree (stripe_event_id) WHERE (stripe_event_id IS NOT NULL);

-- ------------------------------------------------------------ triggers (41)
CREATE TRIGGER athlete_goals_touch BEFORE UPDATE ON athlete_goals FOR EACH ROW EXECUTE FUNCTION sporve_touch_updated_at();
CREATE TRIGGER trg_enforce_athlete_consent BEFORE INSERT OR UPDATE ON athletes FOR EACH ROW EXECUTE FUNCTION enforce_athlete_consent();
CREATE TRIGGER aa_enforce_booking_program_matches_session BEFORE INSERT OR UPDATE OF session_id, program_id ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_program_matches_session();
CREATE TRIGGER bookings_link_proposal AFTER INSERT OR UPDATE OF plan_proposal_id ON bookings FOR EACH ROW EXECUTE FUNCTION sporve_link_booking_to_proposal();
CREATE TRIGGER trg_booking_fee_server_only BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_fee_server_only();
CREATE TRIGGER trg_enforce_booking_athlete_consent BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_athlete_consent();
CREATE TRIGGER trg_enforce_booking_member_org BEFORE INSERT OR UPDATE OF assigned_member_id, program_id, session_id ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_member_org();
CREATE TRIGGER trg_enforce_booking_provider_update BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_provider_update();
CREATE TRIGGER trg_enforce_booking_provider_verified BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_provider_verified();
CREATE TRIGGER trg_enforce_booking_session_capacity BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_session_capacity();
CREATE TRIGGER trg_enqueue_lifecycle_on_booking AFTER UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION enqueue_lifecycle_on_booking();
CREATE TRIGGER trg_maintain_program_enrolled_count AFTER INSERT OR DELETE OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION maintain_program_enrolled_count();
CREATE TRIGGER trg_set_booking_price BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION set_booking_price();
CREATE TRIGGER trg_snapshot_booking_cancellation_policy BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION snapshot_booking_cancellation_policy();
CREATE TRIGGER trg_stamp_booking_provider_response BEFORE UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION stamp_booking_provider_response();
CREATE TRIGGER trg_stamp_provider_first_booking AFTER INSERT OR UPDATE OF payment_status ON bookings FOR EACH ROW EXECUTE FUNCTION stamp_provider_first_booking();
CREATE TRIGGER trg_enforce_coach_agent_turn_write BEFORE INSERT OR UPDATE ON coach_agent_turns FOR EACH ROW EXECUTE FUNCTION enforce_coach_agent_turn_write();
CREATE TRIGGER trg_enforce_coach_invite BEFORE INSERT OR UPDATE ON coach_invites FOR EACH ROW EXECUTE FUNCTION enforce_coach_invite();
CREATE TRIGGER development_plans_touch BEFORE UPDATE ON development_plans FOR EACH ROW EXECUTE FUNCTION sporve_touch_updated_at();
CREATE TRIGGER trg_disputes_touch BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION tg_touch_updated_at();
CREATE TRIGGER trg_enforce_dispute_insert BEFORE INSERT ON disputes FOR EACH ROW EXECUTE FUNCTION enforce_dispute_insert();
CREATE TRIGGER trg_enforce_dispute_update BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION enforce_dispute_update();
CREATE TRIGGER trg_touch_lifecycle_prefs BEFORE UPDATE ON lifecycle_message_prefs FOR EACH ROW EXECUTE FUNCTION touch_lifecycle_prefs();
CREATE TRIGGER messages_rate_limit BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION enforce_message_rate_limit();
CREATE TRIGGER trg_enforce_org_member BEFORE INSERT OR UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION enforce_org_member();
CREATE TRIGGER trg_org_members_touch BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION tg_touch_updated_at();
CREATE TRIGGER trg_outbound_freeze BEFORE UPDATE ON outbound_messages FOR EACH ROW EXECUTE FUNCTION outbound_freeze_server_columns();
CREATE TRIGGER plan_proposals_parent_guard BEFORE UPDATE ON plan_proposals FOR EACH ROW EXECUTE FUNCTION sporve_plan_proposals_guard();
CREATE TRIGGER profiles_role_immutable BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_profile_role_change();
CREATE TRIGGER trg_enforce_waitlist_write BEFORE INSERT OR UPDATE ON program_waitlist FOR EACH ROW EXECUTE FUNCTION enforce_waitlist_write();
CREATE TRIGGER trg_enforce_program_assignment BEFORE INSERT OR UPDATE OF assigned_member_id, provider_id ON programs FOR EACH ROW EXECUTE FUNCTION enforce_program_assignment();
CREATE TRIGGER trg_programs_freeze_server_columns BEFORE UPDATE ON programs FOR EACH ROW EXECUTE FUNCTION programs_freeze_server_columns();
CREATE TRIGGER progress_digest_source_guard BEFORE INSERT OR UPDATE ON progress_digest_sources FOR EACH ROW EXECUTE FUNCTION validate_progress_digest_source();
CREATE TRIGGER trg_enforce_provider_availability_signals BEFORE INSERT OR UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION enforce_provider_availability_signals();
CREATE TRIGGER trg_enforce_provider_trust BEFORE INSERT OR UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION enforce_provider_trust();
CREATE TRIGGER trg_stamp_provider_activation BEFORE INSERT OR UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION stamp_provider_activation();
CREATE TRIGGER trg_sync_public_coords BEFORE INSERT OR UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION sync_public_coords();
CREATE TRIGGER trg_enforce_review_authorship BEFORE INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION enforce_review_authorship();
CREATE TRIGGER trg_enforce_review_update BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION enforce_review_update();
CREATE TRIGGER trg_on_review_submitted AFTER INSERT ON reviews FOR EACH ROW WHEN (new.booking_id IS NOT NULL) EXECUTE FUNCTION on_review_submitted();
CREATE TRIGGER trg_reviews_aggregates AFTER INSERT OR DELETE OR UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION reviews_touch_aggregates();

-- NOTE: handle_new_user is attached to auth.users (outside the public schema):
--   CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--     FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------ event trigger (RLS auto-enable)
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') EXECUTE FUNCTION rls_auto_enable();

-- ------------------------------------------------------------ row level security (all 50 tables)
ALTER TABLE public.ai_alert_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_alert_thresholds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_observability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_observability_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_agent_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_http_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_message_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_readiness_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_event_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_digest_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_parse_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_dead_letter ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------ policies (134)
CREATE POLICY ai_alert_thresholds_no_client_access ON public.ai_alert_thresholds AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY ai_audit_log_no_client_access ON public.ai_audit_log AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY ai_feedback_no_client_access ON public.ai_feedback FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY ai_observability_events_no_client_access ON public.ai_observability_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY ai_usage_select_own ON public.ai_usage FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = ai_usage.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY athlete_goals_delete_parent ON public.athlete_goals FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = athlete_goals.athlete_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY athlete_goals_insert_parent ON public.athlete_goals FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = athlete_goals.athlete_id) AND (a.parent_id = auth.uid()))))));
CREATE POLICY athlete_goals_select_parent ON public.athlete_goals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = athlete_goals.athlete_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY athlete_goals_update_parent ON public.athlete_goals FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = athlete_goals.athlete_id) AND (a.parent_id = auth.uid()))))) WITH CHECK (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = athlete_goals.athlete_id) AND (a.parent_id = auth.uid()))))));
CREATE POLICY athletes_delete_parent ON public.athletes FOR DELETE TO authenticated USING ((parent_id = auth.uid()));
CREATE POLICY athletes_insert_parent ON public.athletes FOR INSERT TO authenticated WITH CHECK ((parent_id = auth.uid()));
CREATE POLICY athletes_select_parent ON public.athletes FOR SELECT TO authenticated USING ((parent_id = auth.uid()));
CREATE POLICY athletes_update_parent ON public.athletes FOR UPDATE TO authenticated USING ((parent_id = auth.uid())) WITH CHECK ((parent_id = auth.uid()));
CREATE POLICY billing_subscriptions_no_client_access ON public.billing_subscriptions FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY bookings_delete_searcher ON public.bookings FOR DELETE TO authenticated USING ((searcher_id = auth.uid()));
CREATE POLICY bookings_insert_searcher ON public.bookings FOR INSERT TO authenticated WITH CHECK ((searcher_id = auth.uid()));
CREATE POLICY bookings_select_provider ON public.bookings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((sessions s
     JOIN programs pr ON ((pr.id = s.program_id)))
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((s.id = bookings.session_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY bookings_select_searcher ON public.bookings FOR SELECT TO authenticated USING ((searcher_id = auth.uid()));
CREATE POLICY bookings_update_provider ON public.bookings FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((sessions s
     JOIN programs pr ON ((pr.id = s.program_id)))
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((s.id = bookings.session_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ((sessions s
     JOIN programs pr ON ((pr.id = s.program_id)))
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((s.id = bookings.session_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY bookings_update_searcher ON public.bookings FOR UPDATE TO authenticated USING ((searcher_id = auth.uid())) WITH CHECK ((searcher_id = auth.uid()));
CREATE POLICY coach_agent_turns_insert_own ON public.coach_agent_turns FOR INSERT TO authenticated WITH CHECK ((coach_id = auth.uid()));
CREATE POLICY coach_agent_turns_select_own ON public.coach_agent_turns FOR SELECT TO authenticated USING ((coach_id = auth.uid()));
CREATE POLICY coach_agent_turns_update_own ON public.coach_agent_turns FOR UPDATE TO authenticated USING ((coach_id = auth.uid())) WITH CHECK ((coach_id = auth.uid()));
CREATE POLICY coach_invites_delete_provider ON public.coach_invites FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = coach_invites.provider_id) AND (pv.owner_id = auth.uid())))) AND (status = 'pending'::text)));
CREATE POLICY coach_invites_insert_provider ON public.coach_invites FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = coach_invites.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY coach_invites_select_provider ON public.coach_invites FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = coach_invites.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY coach_invites_select_redeemer ON public.coach_invites FOR SELECT TO authenticated USING ((redeemed_by = auth.uid()));
CREATE POLICY coach_invites_update_provider ON public.coach_invites FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = coach_invites.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = coach_invites.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY conversations_insert_participant ON public.conversations FOR INSERT TO authenticated WITH CHECK (((auth.uid() = searcher_id) OR (auth.uid() = provider_id)));
CREATE POLICY conversations_select_participant ON public.conversations FOR SELECT TO authenticated USING (((auth.uid() = searcher_id) OR (auth.uid() = provider_id)));
CREATE POLICY conversations_update_participant ON public.conversations FOR UPDATE TO authenticated USING (((auth.uid() = searcher_id) OR (auth.uid() = provider_id))) WITH CHECK (((auth.uid() = searcher_id) OR (auth.uid() = provider_id)));
CREATE POLICY cron_http_audit_no_client_access ON public.cron_http_audit FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY development_plans_delete_parent ON public.development_plans FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (athlete_goals g
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((g.id = development_plans.goal_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY development_plans_insert_parent ON public.development_plans FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (athlete_goals g
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((g.id = development_plans.goal_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY development_plans_select_parent ON public.development_plans FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (athlete_goals g
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((g.id = development_plans.goal_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY development_plans_update_parent ON public.development_plans FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (athlete_goals g
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((g.id = development_plans.goal_id) AND (a.parent_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (athlete_goals g
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((g.id = development_plans.goal_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY disputes_insert_party ON public.disputes FOR INSERT TO authenticated WITH CHECK (((opener_id = auth.uid()) AND is_booking_party(booking_id)));
CREATE POLICY disputes_select_party ON public.disputes FOR SELECT TO authenticated USING (((opener_id = auth.uid()) OR is_booking_party(booking_id)));
CREATE POLICY disputes_update_party ON public.disputes FOR UPDATE TO authenticated USING (is_booking_party(booking_id)) WITH CHECK (is_booking_party(booking_id));
CREATE POLICY edge_rate_limits_no_client_access ON public.edge_rate_limits AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY facilities_insert ON public.facilities FOR INSERT TO authenticated WITH CHECK ((added_by IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = auth.uid()))));
CREATE POLICY facilities_select ON public.facilities FOR SELECT TO authenticated USING (true);
CREATE POLICY facilities_update ON public.facilities FOR UPDATE TO authenticated USING ((added_by IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = auth.uid())))) WITH CHECK ((added_by IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = auth.uid()))));
CREATE POLICY facility_notes_insert ON public.facility_notes FOR INSERT TO authenticated WITH CHECK ((provider_id IN ( SELECT providers.id
   FROM providers
  WHERE (providers.owner_id = auth.uid()))));
CREATE POLICY facility_notes_select ON public.facility_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY lmp_delete_owner ON public.lifecycle_message_prefs FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = lifecycle_message_prefs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY lmp_insert_owner ON public.lifecycle_message_prefs FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = lifecycle_message_prefs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY lmp_select_owner ON public.lifecycle_message_prefs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = lifecycle_message_prefs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY lmp_update_owner ON public.lifecycle_message_prefs FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = lifecycle_message_prefs.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = lifecycle_message_prefs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY market_overrides_no_client_access ON public.market_overrides AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY market_readiness_config_no_client_access ON public.market_readiness_config AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY messages_insert_sender ON public.messages FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.searcher_id) OR (auth.uid() = c.provider_id)))))));
CREATE POLICY messages_select_participant ON public.messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid() = c.searcher_id) OR (auth.uid() = c.provider_id))))));
CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY organization_members_delete_admin ON public.organization_members FOR DELETE TO authenticated USING (is_org_admin(organization_id));
CREATE POLICY organization_members_insert_admin ON public.organization_members FOR INSERT TO authenticated WITH CHECK (is_org_admin(organization_id));
CREATE POLICY organization_members_select_admin ON public.organization_members FOR SELECT TO authenticated USING (is_org_admin(organization_id));
CREATE POLICY organization_members_select_public ON public.organization_members FOR SELECT TO anon, authenticated USING (((background_check_status = 'verified'::text) AND (is_active = true) AND (EXISTS ( SELECT 1
   FROM providers p
  WHERE ((p.id = organization_members.organization_id) AND (p.status = 'approved'::text)))) AND (EXISTS ( SELECT 1
   FROM programs pr
  WHERE ((pr.provider_id = organization_members.organization_id) AND (pr.status = 'published'::text))))));
CREATE POLICY organization_members_select_self ON public.organization_members FOR SELECT TO authenticated USING ((member_user_id = auth.uid()));
CREATE POLICY organization_members_update_admin ON public.organization_members FOR UPDATE TO authenticated USING (is_org_admin(organization_id)) WITH CHECK (is_org_admin(organization_id));
CREATE POLICY organization_members_update_self ON public.organization_members FOR UPDATE TO authenticated USING ((member_user_id = auth.uid())) WITH CHECK ((member_user_id = auth.uid()));
CREATE POLICY om_select_owner ON public.outbound_messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = outbound_messages.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY om_update_owner ON public.outbound_messages FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = outbound_messages.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = outbound_messages.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY parent_updates_delete_coach ON public.parent_updates FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = parent_updates.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY parent_updates_insert_coach ON public.parent_updates FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = parent_updates.provider_id) AND (pv.owner_id = auth.uid())))));

CREATE POLICY parent_updates_select_coach ON public.parent_updates FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = parent_updates.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY parent_updates_select_guardian ON public.parent_updates FOR SELECT TO authenticated USING (((status = 'sent'::text) AND (EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = parent_updates.child_id) AND (a.parent_id = auth.uid()))))));
CREATE POLICY parent_updates_update_coach ON public.parent_updates FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = parent_updates.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = parent_updates.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY payment_event_ledger_no_client_access ON public.payment_event_ledger AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY plan_entitlements_public_read ON public.plan_entitlements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY plan_proposals_select_parent ON public.plan_proposals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((development_plans dp
     JOIN athlete_goals g ON ((g.id = dp.goal_id)))
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((dp.id = plan_proposals.plan_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY plan_proposals_update_parent ON public.plan_proposals FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((development_plans dp
     JOIN athlete_goals g ON ((g.id = dp.goal_id)))
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((dp.id = plan_proposals.plan_id) AND (a.parent_id = auth.uid()))))) WITH CHECK (((status = ANY (ARRAY['accepted'::text, 'declined'::text])) AND (EXISTS ( SELECT 1
   FROM ((development_plans dp
     JOIN athlete_goals g ON ((g.id = dp.goal_id)))
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((dp.id = plan_proposals.plan_id) AND (a.parent_id = auth.uid()))))));
CREATE POLICY privacy_requests_insert_owner ON public.privacy_requests FOR INSERT TO authenticated WITH CHECK (((requester_id = auth.uid()) AND (status = 'submitted'::text)));
CREATE POLICY privacy_requests_select_owner ON public.privacy_requests FOR SELECT TO authenticated USING ((requester_id = auth.uid()));
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));
CREATE POLICY program_fixtures_owner_all ON public.program_fixtures FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = program_fixtures.program_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = program_fixtures.program_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY program_fixtures_select_public ON public.program_fixtures FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM programs pr
  WHERE ((pr.id = program_fixtures.program_id) AND (pr.status = 'published'::text)))));
CREATE POLICY program_waitlist_delete_searcher ON public.program_waitlist FOR DELETE TO authenticated USING ((searcher_id = auth.uid()));
CREATE POLICY program_waitlist_insert_searcher ON public.program_waitlist FOR INSERT TO authenticated WITH CHECK ((searcher_id = auth.uid()));
CREATE POLICY program_waitlist_select_provider ON public.program_waitlist FOR SELECT TO authenticated USING (is_program_provider_owner(program_id));
CREATE POLICY program_waitlist_select_searcher ON public.program_waitlist FOR SELECT TO authenticated USING ((searcher_id = auth.uid()));
CREATE POLICY program_waitlist_update_provider ON public.program_waitlist FOR UPDATE TO authenticated USING (is_program_provider_owner(program_id)) WITH CHECK (is_program_provider_owner(program_id));
CREATE POLICY program_waitlist_update_searcher ON public.program_waitlist FOR UPDATE TO authenticated USING ((searcher_id = auth.uid())) WITH CHECK ((searcher_id = auth.uid()));
CREATE POLICY programs_delete_owner ON public.programs FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = programs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY programs_insert_owner ON public.programs FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = programs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY programs_select_owner ON public.programs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = programs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY programs_select_public ON public.programs FOR SELECT TO public USING ((status = 'published'::text));
CREATE POLICY programs_update_owner ON public.programs FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = programs.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = programs.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY progress_digest_sources_select_guardian ON public.progress_digest_sources FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (progress_digests d
     JOIN athletes a ON ((a.id = d.athlete_id)))
  WHERE ((d.id = progress_digest_sources.digest_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY progress_digests_select_parent ON public.progress_digests FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((development_plans dp
     JOIN athlete_goals g ON ((g.id = dp.goal_id)))
     JOIN athletes a ON ((a.id = g.athlete_id)))
  WHERE ((dp.id = progress_digests.plan_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY providers_delete_owner ON public.providers FOR DELETE TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY providers_insert_owner ON public.providers FOR INSERT TO authenticated WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY providers_select_owner ON public.providers FOR SELECT TO authenticated USING ((owner_id = auth.uid()));
CREATE POLICY providers_select_public ON public.providers FOR SELECT TO public USING ((status = 'approved'::text));
CREATE POLICY providers_update_owner ON public.providers FOR UPDATE TO authenticated USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY refund_requests_insert_owner ON public.refund_requests FOR INSERT TO authenticated WITH CHECK (((requester_id = auth.uid()) AND (status = 'submitted'::text) AND (EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = refund_requests.booking_id) AND (b.searcher_id = auth.uid()) AND (b.payment_status = ANY (ARRAY['paid'::text, 'partially_refunded'::text])))))));
CREATE POLICY refund_requests_select_owner ON public.refund_requests FOR SELECT TO authenticated USING ((requester_id = auth.uid()));
CREATE POLICY review_windows_no_client_access ON public.review_windows FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY reviews_delete_author ON public.reviews FOR DELETE TO authenticated USING (((author_id = auth.uid()) AND (published_at IS NULL)));
CREATE POLICY reviews_insert_author ON public.reviews FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (published_at IS NULL)));
CREATE POLICY reviews_select_author ON public.reviews FOR SELECT TO authenticated USING ((author_id = auth.uid()));
CREATE POLICY reviews_select_published ON public.reviews FOR SELECT TO anon, authenticated USING (((published_at IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM programs p
  WHERE ((p.id = reviews.program_id) AND (p.status = 'published'::text))))));
CREATE POLICY reviews_update_author ON public.reviews FOR UPDATE TO authenticated USING ((author_id = auth.uid())) WITH CHECK ((author_id = auth.uid()));
CREATE POLICY reviews_update_provider_response ON public.reviews FOR UPDATE TO authenticated USING (((booking_id IS NOT NULL) AND is_booking_provider_owner(booking_id))) WITH CHECK (((booking_id IS NOT NULL) AND is_booking_provider_owner(booking_id)));
CREATE POLICY safety_reports_select_reporter ON public.safety_reports FOR SELECT TO authenticated USING ((reporter_id = auth.uid()));
CREATE POLICY search_parse_cache_no_client_access ON public.search_parse_cache AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY session_notes_delete_coach ON public.session_notes FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = session_notes.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY session_notes_insert_coach ON public.session_notes FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = session_notes.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY session_notes_select_coach ON public.session_notes FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = session_notes.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY session_notes_update_coach ON public.session_notes FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = session_notes.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = session_notes.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY sessions_delete_owner ON public.sessions FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = sessions.program_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY sessions_insert_owner ON public.sessions FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = sessions.program_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY sessions_select_owner ON public.sessions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = sessions.program_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY sessions_select_public ON public.sessions FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM programs p
  WHERE ((p.id = sessions.program_id) AND (p.status = 'published'::text)))));
CREATE POLICY sessions_update_owner ON public.sessions FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = sessions.program_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (programs pr
     JOIN providers pv ON ((pv.id = pr.provider_id)))
  WHERE ((pr.id = sessions.program_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY staff_certifications_admin_all ON public.staff_certifications FOR ALL TO authenticated USING (is_org_admin(organization_id)) WITH CHECK ((is_org_admin(organization_id) AND (status = ANY (ARRAY['none'::text, 'pending'::text]))));
CREATE POLICY staff_certifications_select_self ON public.staff_certifications FOR SELECT TO authenticated USING ((member_user_id = auth.uid()));
CREATE POLICY team_athletes_delete_owner ON public.team_athletes FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (teams t
     JOIN providers pv ON ((pv.id = t.provider_id)))
  WHERE ((t.id = team_athletes.team_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY team_athletes_insert_owner ON public.team_athletes FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (teams t
     JOIN providers pv ON ((pv.id = t.provider_id)))
  WHERE ((t.id = team_athletes.team_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY team_athletes_select_owner ON public.team_athletes FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (teams t
     JOIN providers pv ON ((pv.id = t.provider_id)))
  WHERE ((t.id = team_athletes.team_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY team_athletes_select_parent ON public.team_athletes FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM athletes a
  WHERE ((a.id = team_athletes.athlete_id) AND (a.parent_id = auth.uid())))));
CREATE POLICY team_athletes_update_owner ON public.team_athletes FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (teams t
     JOIN providers pv ON ((pv.id = t.provider_id)))
  WHERE ((t.id = team_athletes.team_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (teams t
     JOIN providers pv ON ((pv.id = t.provider_id)))
  WHERE ((t.id = team_athletes.team_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY teams_delete_owner ON public.teams FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = teams.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY teams_insert_owner ON public.teams FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = teams.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY teams_select_owner ON public.teams FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = teams.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY teams_select_parent ON public.teams FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (team_athletes ta
     JOIN athletes a ON ((a.id = ta.athlete_id)))
  WHERE ((ta.team_id = teams.id) AND (a.parent_id = auth.uid())))));
CREATE POLICY teams_update_owner ON public.teams FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = teams.provider_id) AND (pv.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM providers pv
  WHERE ((pv.id = teams.provider_id) AND (pv.owner_id = auth.uid())))));
CREATE POLICY waitlist_no_client_access ON public.waitlist FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY waitlist_rate_limit_no_client_access ON public.waitlist_rate_limit AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY webhook_dead_letter_no_client_access ON public.webhook_dead_letter FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ------------------------------------------------------------ grants
-- The privacy model is carried by GRANTS, not only policies: providers has NO
-- table-level SELECT for anon/authenticated — readable columns are granted
-- one-by-one (exact lat/lng, stripe ids, and owner_id-for-anon are withheld).
-- Supabase default privileges hand ALL to the api roles on new objects, so on
-- a fresh apply the deviations below must be re-imposed by explicit REVOKEs.
REVOKE SELECT ON public.providers FROM anon, authenticated;
GRANT SELECT (id, business_name, bio, sports, location, status, onboarding_completed, verification_status, created_at, background_check_status, coach_years_coaching, coach_years_played, credentials, provider_type, background_check_completed_at, public_latitude, public_longitude, avatar_url, logo_url) ON public.providers TO anon;
GRANT SELECT (id, owner_id, business_name, bio, sports, location, status, onboarding_completed, verification_status, created_at, stripe_charges_enabled, background_check_status, account_status, coach_years_coaching, coach_years_played, credentials, provider_type, background_check_completed_at, public_latitude, public_longitude, cancellation_policy, what_to_bring, travel_radius, session_notes, faq, buffer_minutes, vacation_until, verified_at, payout_enabled_at, first_booking_at, last_active_at, instant_book_enabled, avatar_url, logo_url, plan, plan_status, plan_period_end, founding_coach) ON public.providers TO authenticated;

-- Tables where the api roles hold LESS than the default ALL (captured ACLs):
REVOKE ALL ON public.ai_alert_thresholds FROM anon, authenticated;                       -- service_role only
GRANT UPDATE (warning_threshold, critical_threshold, min_sample_size, enabled, updated_at) ON public.ai_alert_thresholds TO service_role;
REVOKE ALL ON public.ai_audit_log FROM anon, authenticated;                              -- service_role only
REVOKE ALL ON public.ai_feedback FROM anon, authenticated;                               -- service_role only
REVOKE ALL ON public.ai_observability_events FROM anon, authenticated;                   -- service_role only
REVOKE ALL ON public.coach_agent_turns FROM anon;                                        -- authenticated + service_role
REVOKE ALL ON public.coach_invites FROM anon;                                            -- authenticated + service_role
REVOKE ALL ON public.cron_http_audit FROM anon, authenticated;                           -- service_role only
REVOKE DELETE ON public.disputes FROM anon, authenticated;                               -- disputes are never client-deleted
REVOKE ALL ON public.edge_rate_limits FROM anon, authenticated;                          -- service_role only
REVOKE ALL ON public.market_overrides FROM anon, authenticated;                          -- service_role only
REVOKE ALL ON public.market_readiness_config FROM anon, authenticated;                   -- service_role only
REVOKE ALL ON public.outbound_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON public.outbound_messages FROM authenticated;  -- SELECT only; writes go through the worker + freeze trigger
REVOKE ALL ON public.payment_event_ledger FROM anon, authenticated;                      -- service_role only
REVOKE DELETE, UPDATE ON public.privacy_requests FROM anon, authenticated;               -- append-only for clients
REVOKE ALL ON public.program_waitlist FROM anon;                                         -- authenticated + service_role
REVOKE DELETE, UPDATE ON public.refund_requests FROM anon, authenticated;                -- append-only for clients
REVOKE ALL ON public.review_windows FROM anon, authenticated;                            -- service_role only
REVOKE ALL ON public.safety_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON public.safety_reports FROM authenticated;     -- SELECT own; inserts go through submit_safety_report()
REVOKE ALL ON public.search_parse_cache FROM anon, authenticated;                        -- service_role only
REVOKE ALL ON public.waitlist_rate_limit FROM anon, authenticated;                       -- service_role only
-- Analytics views: service_role only.
REVOKE ALL ON public.ai_ops_alerts, public.ai_ops_feedback_daily, public.ai_ops_hourly,
           public.coach_activation_funnel, public.cron_http_health, public.cron_latest_status,
           public.market_readiness_overview, public.repeat_booking_stats, public.stale_providers
  FROM anon, authenticated;
GRANT SELECT ON public.provider_booking_operations TO anon, authenticated;               -- security_invoker; rows scoped by bookings RLS

-- Function EXECUTE: prod pins each function to an explicit grantee list.
-- Locked to service_role (+postgres) only — the money/admin/worker surface:
REVOKE ALL ON FUNCTION public.admin_set_instant_book(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_member_background_check(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_provider_verification(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_production_invariants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stripe_billing_event(text, text, uuid, text, text, text, text, timestamptz, timestamptz, boolean, text, bigint, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stripe_booking_event(text, text, uuid, text, bigint, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stripe_booking_event(text, text, uuid, text, bigint, text, text, timestamptz, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_cron_http_health() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_production_invariants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_edge_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_outbound_message(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_rebook_nudges(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_reminders_24h() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_coach_brought_family(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_market_ready(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ltad_max_tier(integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_readiness(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_eligible(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.metro_key(double precision, double precision, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_review_pair(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_ai_feedback() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_ai_observability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_review_aggregates(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_webhook_dead_letter(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_due_reviews() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_ai_capacity(text, text, uuid, text, text, numeric, integer, integer, numeric, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_ai_data_retention() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_candidates(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_listings(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_relax(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_ai_feedback(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
-- Callable by authenticated users (and service_role); anon revoked:
REVOKE ALL ON FUNCTION public.booking_refund_quote(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_organization_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_provider_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_ai_quota(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.data_health() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_provider_conversation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_provider() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_booking_party(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_booking_provider_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_booking_searcher(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_program_provider_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_coach_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_safety_report(uuid, text, text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_provider_activity() FROM PUBLIC, anon;
-- Trigger functions with default-ish grants (anon+authenticated may hold
-- EXECUTE — harmless: trigger functions cannot be invoked directly) keep the
-- Supabase defaults; no statement needed.

-- ------------------------------------------------------------ realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ------------------------------------------------------------ cron jobs (recorded; apply via SQL editor after the schema)
-- SELECT cron.schedule('cron-http-health',          '*/5 * * * *', 'select public.check_cron_http_health();');
-- SELECT cron.schedule('lifecycle-process',         '* * * * *',   'select public.invoke_lifecycle_process();');
-- SELECT cron.schedule('lifecycle-rebook-nudges',   '0 8 * * *',   'select public.enqueue_rebook_nudges();');
-- SELECT cron.schedule('lifecycle-reminders-24h',   '0 * * * *',   'select public.enqueue_reminders_24h();');
-- SELECT cron.schedule('production-invariants',     '0 * * * *',   'select public.alert_production_invariants();');
-- SELECT cron.schedule('release-due-reviews',       '30 9 * * *',  'select public.release_due_reviews();');
-- SELECT cron.schedule('sporve-ai-retention-daily', '17 3 * * *',  'select public.run_ai_data_retention();');

-- ============================================================================
-- END OF BASELINE. Out of scope for a public-schema baseline (owner-managed):
-- vault secrets (project_url, cron_secret), storage buckets + storage policies
-- (provider-media), auth settings, and edge functions (deployed via CLI).
-- ============================================================================

