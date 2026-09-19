-- 20260915_001101 — obligations: add the two agent columns every generator
-- already assumes exist.
--
-- Root cause of the signed-in dashboard "COULDN'T LOAD YOUR QUEUE" failure
-- (2026-09-19): the queue read embeds why:why_finding_id(title), but no
-- migration ever added why_finding_id (or draft_type) to public.obligations.
-- Reproduced live on the canonical project: PGRST200 "Could not find a
-- relationship between 'obligations' and 'why_finding_id' in the schema
-- cache", and selecting the column alone gives 42703
-- "column obligations.why_finding_id does not exist".
--
-- Migrations 20260902_001020, 20260904_001023, 20260910_001045,
-- 20260915_001069/001070/001073/001079 all insert or read
-- obligations.draft_type / obligations.why_finding_id, so on a fresh apply
-- (the canonical project) the generators fail at runtime and the queue
-- read fails at validation. The old project must have received these
-- columns through an ad-hoc query that never landed in the migration
-- history — this file closes that gap.
--
-- Idempotent: add-if-not-exists throughout. The FK mirrors the one on
-- agent_proposals.why_finding_id (set null on finding delete; a draft
-- outlives its finding).

alter table public.obligations
  add column if not exists why_finding_id uuid
    references public.agent_findings(id) on delete set null,
  add column if not exists draft_type text;

comment on column public.obligations.why_finding_id is
  'agent_findings row this draft was generated from; null for manual drafts';
comment on column public.obligations.draft_type is
  'agent draft subtype (idle_capacity_offer, waiver_followup, schedule_cancellation, ...); null for manual drafts';
