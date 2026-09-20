-- 2026-09-20 · agent_findings: columns the gmail-scan writer already emits.
--
-- findingFor() in supabase/functions/_shared/gmail-read.mjs builds rows with
-- subject_type / subject_id / evidence, and the unit test pins that shape —
-- but the table never had the columns, so the insert failed and the scan
-- produced nothing. Add them rather than dumbing the writer down: a typed
-- subject and structured, explicitly-untrusted evidence are the design.
alter table public.agent_findings
  add column if not exists subject_type text,
  add column if not exists subject_id uuid,
  add column if not exists evidence jsonb;

comment on column public.agent_findings.subject_type is
  'What the finding is about: guardian, athlete, staff, invoice… NULL when the finding has no single subject.';
comment on column public.agent_findings.subject_id is
  'Id of the subject row (e.g. guardians.id). NULL when there is no single subject.';
comment on column public.agent_findings.evidence is
  'Structured provenance for the finding (connector id, message ids, raw values). Untrusted content arrives fenced in detail; evidence says so explicitly.';
