-- 2026-09-20: the RLS policy om_insert_coach_drafted existed but the
-- authenticated role had no GRANT on the table, so every coach draft insert
-- failed with "permission denied for table outbound_messages" (F1 root cause
-- #2 — the check-constraint fix alone was not enough). Coaches insert drafts
-- (status='drafted') via coach-command and flip them to approved/declined via
-- the approval flow; both need table privileges before RLS policies apply.
GRANT INSERT, UPDATE ON public.outbound_messages TO authenticated;
