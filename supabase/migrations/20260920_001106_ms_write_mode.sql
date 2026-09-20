-- 2026-09-20 · reconcile org_connectors_no_send with the connector registry.
--
-- The registry gives microsoft365 write 'apply' (approved calendar writes),
-- but the no_send check constraint capped gmail/microsoft365/sms at
-- ('none','draft'), so the Microsoft callback could never record its real
-- write mode. The no-send invariant does NOT rest on this constraint: it is
-- enforced at the OAuth layer — microsoft-oauth-callback asserts the granted
-- scopes contain no Mail.Send/Mail.ReadWrite (FORBIDDEN_SCOPES), and only
-- Mail.Read is ever requested. 'apply' for microsoft365 means calendar
-- writes the human approved, never mail. gmail and sms stay capped at
-- ('none','draft').
alter table public.org_connectors
  drop constraint if exists org_connectors_no_send;

alter table public.org_connectors
  add constraint org_connectors_no_send check (
    case
      when kind = 'microsoft365'::connector_kind
        then write_mode = any (array['none'::connector_write_mode,
                                    'draft'::connector_write_mode,
                                    'apply'::connector_write_mode])
      when kind = any (array['gmail'::connector_kind, 'sms'::connector_kind])
        then write_mode = any (array['none'::connector_write_mode,
                                    'draft'::connector_write_mode])
      else true
    end
  );
