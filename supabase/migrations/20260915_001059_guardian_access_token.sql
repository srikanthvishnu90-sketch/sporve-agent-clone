-- 20260915_001059 — spec 13.3 · guardian access tokens (magic links), slice 1.
-- Fable block. FILE ONLY — never applied to tseszaprvtvqrkfpditu (D5).
--
-- A guardian never installs an app and never sets a password. Everything a
-- parent does arrives as a URL, and that URL WILL be forwarded into a group chat.
-- So the design assumes a leaked link and makes leaking it nearly worthless:
--   * only the sha256 of the secret is stored — the secret exists once, in the
--     outbound message; a database read cannot reproduce it;
--   * scope is narrow and BOUND to one subject: an 'rsvp' token opens the RSVP
--     for one event and nothing else. There is no 'full' and no 'profile' scope
--     — nothing medical, no emergency contact, no sibling list is ever readable
--     through a token;
--   * the DATABASE is the boundary, not the edge function. A token-authenticated
--     function runs as service_role, which bypasses RLS, so every read and write
--     goes through a SECURITY DEFINER RPC that takes the token as its only
--     argument and returns nothing for an unknown, expired, revoked or consumed
--     token (the shape spec 12's calendar_feed_events already uses);
--   * GET never consumes. Messaging apps fetch a pasted URL to unfurl it, which
--     would burn a single-use link before the parent taps. Consumption is an
--     explicit POST-side call;
--   * issuance AND redemption are rate-limited through consume_edge_rate_limit;
--   * tokens die with the guardian row (FK cascade) and are revoked wholesale
--     when the guardian's email or phone changes (rotation trigger).
-- Org root is providers (ruling R1). Roster identity is team_athletes.id.

create table if not exists public.guardian_access_token (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references public.providers(id) on delete cascade,
  guardian_id   uuid not null references public.guardians(id) on delete cascade,
  token_hash    text not null unique,                       -- sha256 hex of the emitted secret
  scope         text not null check (scope in ('rsvp','waiver','pay','register')),
  subject_kind  text check (subject_kind in ('event','obligation','waiver_document','registration_form')),
  subject_id    uuid,
  channel       text not null default 'email' check (channel in ('email','sms')),
  single_use    boolean not null default false,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- every scope except 'register' is bound to exactly one subject
  constraint guardian_access_token_subject check (
    scope = 'register' or (subject_kind is not null and subject_id is not null))
);
create index if not exists guardian_access_token_guardian_idx on public.guardian_access_token (guardian_id, expires_at);
alter table public.guardian_access_token enable row level security;
alter table public.guardian_access_token force row level security;
revoke all on public.guardian_access_token from public, anon, authenticated;   -- RPC only

create or replace function public.guardian_token_hash(p_secret text) returns text
language sql immutable set search_path to '' as $$
  select encode(extensions.digest(convert_to(p_secret, 'utf8'), 'sha256'), 'hex')
$$;

-- Issue: returns the raw secret ONCE. Staff (is_org_admin) or service_role.
create or replace function public.issue_guardian_token(
  p_guardian uuid, p_scope text, p_subject_kind text default null, p_subject_id uuid default null,
  p_channel text default 'email', p_ttl interval default null)
returns text language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_secret text; v_ttl interval; v_single boolean; v_ok boolean;
begin
  select provider_id into v_provider from public.guardians where id = p_guardian;
  if v_provider is null then raise exception 'guardian not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may issue a guardian link' using errcode = '42501';
  end if;
  if p_scope not in ('rsvp','waiver','pay','register') then
    raise exception 'unknown scope %', p_scope using errcode = '22023';
  end if;
  -- the subject must exist AND belong to the same organisation as the guardian
  if p_scope = 'rsvp' then
    if p_subject_kind is distinct from 'event' or not exists
       (select 1 from public.event e where e.id = p_subject_id and e.provider_id = v_provider) then
      raise exception 'an rsvp link must name an event of this organisation' using errcode = '22023';
    end if;
  elsif p_scope = 'pay' then
    if p_subject_kind is distinct from 'obligation' or not exists
       (select 1 from public.obligations o where o.id = p_subject_id and o.provider_id = v_provider) then
      raise exception 'a pay link must name an obligation of this organisation' using errcode = '22023';
    end if;
  end if;
  -- issuance ceiling: 10 links per guardian per hour
  v_ok := public.consume_edge_rate_limit('guardian:' || p_guardian::text, 'guardian-token-issue', 10, 3600);
  if v_ok is distinct from true then
    raise exception 'too many links issued for this guardian this hour' using errcode = '53400';
  end if;
  v_single := p_scope in ('pay','waiver');
  v_ttl := coalesce(p_ttl, case when v_single then interval '72 hours' else interval '7 days' end);
  v_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.guardian_access_token
    (provider_id, guardian_id, token_hash, scope, subject_kind, subject_id, channel, single_use, expires_at)
  values (v_provider, p_guardian, public.guardian_token_hash(v_secret), p_scope, p_subject_kind, p_subject_id,
          p_channel, v_single, now() + v_ttl);
  return v_secret;
end $$;

-- Redeem: resolve a presented secret to its grant. Zero rows for anything that
-- is not a live, unconsumed, unrevoked, unexpired token. Never mutates state
-- beyond last_used_at, so it is safe on GET.
create or replace function public.redeem_guardian_token(p_token text)
returns table (token_id uuid, guardian_id uuid, provider_id uuid, scope text, subject_kind text, subject_id uuid,
               channel text, single_use boolean, subject_label text, subject_at timestamptz, subject_tz text,
               guardian_first_name text)
language plpgsql security definer set search_path to '' as $$
declare t public.guardian_access_token;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return; end if;
  select * into t from public.guardian_access_token g
   where g.token_hash = public.guardian_token_hash(p_token)
     and g.expires_at > now() and g.revoked_at is null and g.consumed_at is null;
  if not found then return; end if;
  update public.guardian_access_token set last_used_at = now() where id = t.id;
  return query
  select t.id, t.guardian_id, t.provider_id, t.scope, t.subject_kind, t.subject_id, t.channel, t.single_use,
         case when t.subject_kind = 'event' then (select coalesce(tm.name || ' — ', '') || e.title
                from public.event e left join public.teams tm on tm.id = e.team_id where e.id = t.subject_id) end,
         case when t.subject_kind = 'event' then (select e.starts_at from public.event e where e.id = t.subject_id) end,
         case when t.subject_kind = 'event' then (select e.timezone from public.event e where e.id = t.subject_id) end,
         (select g.first_name from public.guardians g where g.id = t.guardian_id);
end $$;

-- Consume: the POST-side call. Marks a single-use token spent; a reusable token
-- passes through. Returns false when the token was not live.
create or replace function public.consume_guardian_token(p_token text) returns boolean
language plpgsql security definer set search_path to '' as $$
declare t public.guardian_access_token;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  select * into t from public.guardian_access_token g
   where g.token_hash = public.guardian_token_hash(p_token)
     and g.expires_at > now() and g.revoked_at is null and g.consumed_at is null for update;
  if not found then return false; end if;
  if t.single_use then update public.guardian_access_token set consumed_at = now() where id = t.id; end if;
  return true;
end $$;

-- Revoke every live token for a guardian (removal, or a rotation event).
create or replace function public.revoke_guardian_tokens(p_guardian uuid, p_reason text default null) returns integer
language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; n integer;
begin
  select provider_id into v_provider from public.guardians where id = p_guardian;
  if v_provider is null then return 0; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may revoke guardian links' using errcode = '42501';
  end if;
  update public.guardian_access_token set revoked_at = now()
   where guardian_id = p_guardian and revoked_at is null and consumed_at is null and expires_at > now();
  get diagnostics n = row_count; return n;
end $$;

-- Rotation: a changed email or phone invalidates every outstanding link.
create or replace function public.guardian_contact_rotated() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  update public.guardian_access_token set revoked_at = now()
   where guardian_id = new.id and revoked_at is null and consumed_at is null and expires_at > now();
  return new;
end $$;
drop trigger if exists trg_guardian_contact_rotated on public.guardians;
create trigger trg_guardian_contact_rotated after update of email, phone on public.guardians
  for each row when (new.email is distinct from old.email or new.phone is distinct from old.phone)
  execute function public.guardian_contact_rotated();

-- The one thing slice 1 lets a parent DO: answer an RSVP. The token names the
-- event; the guardian's linked athletes on that event's team are the subjects.
-- Delegates to spec 12's set_event_response, which is the single RSVP write path
-- for staff, a logged-in guardian and this token — no second path.
create or replace function public.guardian_token_rsvp(
  p_token text, p_response text, p_member uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r record; m record; v_members uuid[] := '{}'; v_team uuid;
begin
  select * into r from public.redeem_guardian_token(p_token);
  if r.token_id is null then raise exception 'link is not valid' using errcode = '42501'; end if;
  if r.scope <> 'rsvp' or r.subject_kind <> 'event' then
    raise exception 'this link cannot answer an RSVP' using errcode = '42501';
  end if;
  if p_response not in ('yes','no','maybe') then raise exception 'response must be yes, no or maybe' using errcode = '22023'; end if;
  select team_id into v_team from public.event where id = r.subject_id;
  for m in
    select ta.id from public.guardian_links gl join public.team_athletes ta on ta.id = gl.member_id
     where gl.guardian_id = r.guardian_id and ta.team_id = v_team and ta.status = 'active'
       and (p_member is null or ta.id = p_member)
  loop
    perform public.set_event_response(r.subject_id, m.id, p_response, r.channel, p_note);
    v_members := v_members || m.id;
  end loop;
  if coalesce(array_length(v_members, 1), 0) = 0 then
    raise exception 'none of your athletes is on this event''s team' using errcode = '42501';
  end if;
  perform public.consume_guardian_token(p_token);
  return jsonb_build_object('event_id', r.subject_id, 'response', p_response, 'members', to_jsonb(v_members));
end $$;

revoke all on function public.guardian_token_hash(text), public.issue_guardian_token(uuid,text,text,uuid,text,interval),
  public.redeem_guardian_token(text), public.consume_guardian_token(text), public.revoke_guardian_tokens(uuid,text),
  public.guardian_token_rsvp(text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.issue_guardian_token(uuid,text,text,uuid,text,interval),
  public.revoke_guardian_tokens(uuid,text) to authenticated, service_role;
grant execute on function public.redeem_guardian_token(text), public.consume_guardian_token(text),
  public.guardian_token_rsvp(text,text,uuid,text) to service_role;
