-- 2026-09-20: allow coach-command's deterministic draft persistence.
-- draftMessageBulk inserts event_type 'coach_draft' / 'coach_bulk_draft' into
-- public.outbound_messages; the pre-existing check constraint rejected every
-- row, so every draft tool call returned "The drafts didn't queue." (F1 root
-- cause across all battery rounds).
ALTER TABLE public.outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_event_type_check;
ALTER TABLE public.outbound_messages
  ADD CONSTRAINT outbound_messages_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'booking_confirmed'::text, 'reminder_24h'::text, 'post_session'::text,
      'no_show_followup'::text, 'rebook_nudge'::text, 'dues_reminder'::text,
      'waiver_reminder'::text, 'practice_reminder'::text, 'schedule_change'::text,
      'reactivation'::text, 'coach_draft'::text, 'coach_bulk_draft'::text
    ])
  );
