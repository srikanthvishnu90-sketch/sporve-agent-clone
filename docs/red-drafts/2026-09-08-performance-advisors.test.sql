-- Dry run for 2026-09-08-performance-advisors.sql. Read-only.
-- Parts A–C: the two pre-flight checks below must both come back EMPTY.
-- Part D: the rewrite preview must show 119 rows BEFORE apply and 0 AFTER
-- (the advisor's auth_rls_initplan count is the external confirmation).

-- A. any idx_* name this migration would create that already exists (must be empty)
select indexname, tablename from pg_indexes
where schemaname='public' and indexname in (
 'idx_agent_findings_member','idx_agent_proposals_applied_by','idx_agent_proposals_why','idx_ai_audit_log_approved_by',
 'idx_bookings_athlete','idx_bookings_cancelled_by','idx_bookings_program','idx_coach_invites_inviter','idx_conversations_program',
 'idx_delivery_events_guardian','idx_delivery_events_message','idx_disputes_decided_by','idx_disputes_proposed_session',
 'idx_facilities_added_by','idx_facility_notes_provider','idx_fee_schedules_program','idx_fee_schedules_season',
 'idx_guardian_links_guardian_org','idx_guardian_links_member_org','idx_guardians_user','idx_import_batches_created_by',
 'idx_installments_member','idx_lmp_updated_by','idx_messages_sender','idx_obligations_approved_by','idx_obligations_created_by',
 'idx_obligations_guardian','idx_obligations_member','idx_obligations_team','idx_obligations_why','idx_outbound_messages_approved_by',
 'idx_outbound_messages_obligation','idx_parent_updates_approved_by','idx_parent_updates_booking','idx_ledger_reverses_entry',
 'idx_plan_proposals_provider','idx_plan_proposals_service','idx_privacy_requests_requester','idx_program_waitlist_athlete',
 'idx_pds_session_note','idx_provider_settings_updated_by','idx_refund_requests_requester','idx_reviews_author','idx_reviews_reviewee',
 'idx_safety_reports_booking','idx_safety_reports_conversation','idx_safety_reports_provider','idx_safety_reports_reporter',
 'idx_settings_audit_changed_by','idx_settings_audit_provider','idx_staff_certifications_attested_by','idx_team_athletes_season',
 'idx_teams_season','idx_waiver_signatures_guardian','idx_waiver_signatures_season','idx_waitlist_rate_limit_ts');

-- C. waitlist_rate_limit must have no id column and no primary key (must be empty)
select 'has id column' as blocker from information_schema.columns where table_schema='public' and table_name='waitlist_rate_limit' and column_name='id'
union all
select 'has primary key' from pg_constraint where conrelid='public.waitlist_rate_limit'::regclass and contype='p';

-- D. rewrite preview: every policy the loop would touch, with its new expressions
-- and a flag when the bare auth.*() sits inside a quoted literal (the migration's
-- read-back check aborts on those; this shows them up front).
select tablename, policyname, cmd, roles,
  regexp_replace(qual, '(?<!select\s)auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi') as new_using,
  regexp_replace(with_check, '(?<!select\s)auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi') as new_check,
  (coalesce(qual,'')||coalesce(with_check,'')) ~ $$'[^']*auth\.(uid|role|jwt)\(\)[^']*'$$ as maybe_in_literal
from pg_policies
where schemaname='public'
  and (coalesce(qual,'')||coalesce(with_check,'')) ~* '(?<!select\s)auth\.(uid|role|jwt)\(\)'
order by maybe_in_literal desc, 1, 2;

-- Contract: policy count, commands and roles are identical before and after.
select count(*) as policies_total,
       md5(string_agg(tablename||policyname||cmd||roles::text, ',' order by tablename, policyname)) as shape_fingerprint
from pg_policies where schemaname='public';
