-- 20260915_001058 — spec 12.5 · per-guardian signed ICS feed.
-- The feed is reachable without login, so the URL is the credential: a 256-bit
-- random token, one active per guardian, revocable and regenerable, never an org
-- id. The emitter is an edge function running as service_role; this function is
-- the only read path and returns NOTHING for a missing or revoked token (→ 404,
-- never stale data). SUMMARY is team + title — no athlete name in any field.

create table if not exists public.calendar_feed_tokens (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  token        text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists calendar_feed_tokens_guardian_idx on public.calendar_feed_tokens (guardian_id);
alter table public.calendar_feed_tokens enable row level security;
alter table public.calendar_feed_tokens force row level security;
revoke all on public.calendar_feed_tokens from public, anon, authenticated;   -- RPC only

create or replace function public.issue_calendar_feed_token(p_guardian uuid) returns text
language plpgsql security definer set search_path to '' as $$
declare v_provider uuid; v_token text;
begin
  select provider_id into v_provider from public.guardians where id = p_guardian;
  if v_provider is null then raise exception 'guardian not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may issue a feed token' using errcode = '42501';
  end if;
  update public.calendar_feed_tokens set revoked_at = now() where guardian_id = p_guardian and revoked_at is null;
  insert into public.calendar_feed_tokens (provider_id, guardian_id) values (v_provider, p_guardian)
    returning token into v_token;
  return v_token;
end $$;
create or replace function public.revoke_calendar_feed_token(p_token text) returns boolean
language plpgsql security definer set search_path to '' as $$
declare v_provider uuid;
begin
  select provider_id into v_provider from public.calendar_feed_tokens where token = p_token and revoked_at is null;
  if v_provider is null then return false; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may revoke a feed token' using errcode = '42501';
  end if;
  update public.calendar_feed_tokens set revoked_at = now() where token = p_token;
  return true;
end $$;
-- guardian removed from the org → token dies with the row (FK cascade) — spec 12.5.

create or replace function public.calendar_feed_events(p_token text)
returns table (uid uuid, sequence integer, status text, summary text, starts_at timestamptz, ends_at timestamptz,
               location text, description text, calname text, arrival_offset_minutes integer)
language plpgsql security definer set search_path to '' as $$
declare t public.calendar_feed_tokens;
begin
  select * into t from public.calendar_feed_tokens where token = p_token and revoked_at is null;
  if not found then return; end if;                      -- missing or revoked: zero rows
  update public.calendar_feed_tokens set last_used_at = now() where id = t.id;
  return query
  select e.id, e.sequence,
         case e.status when 'cancelled' then 'CANCELLED' else 'CONFIRMED' end,
         coalesce(tm.name || ' — ', '') || e.title,          -- no athlete names, ever
         e.starts_at, e.ends_at,
         coalesce(v.address, v.name, e.location_text),
         case when e.arrival_offset_minutes > 0 then 'Arrive ' || e.arrival_offset_minutes || ' min early. ' else '' end
           || coalesce('Note: ' || e.notes, ''),
         p.business_name, e.arrival_offset_minutes
  from public.event e
  join public.providers p on p.id = e.provider_id
  left join public.teams tm on tm.id = e.team_id
  left join public.venue v on v.id = e.venue_id
  where e.provider_id = t.provider_id and e.published_at is not null
    and exists (select 1 from public.guardian_links gl join public.team_athletes ta on ta.id = gl.member_id
                where gl.guardian_id = t.guardian_id and ta.team_id = e.team_id)
  order by e.starts_at;
end $$;
revoke all on function public.issue_calendar_feed_token(uuid), public.revoke_calendar_feed_token(text),
              public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.issue_calendar_feed_token(uuid), public.revoke_calendar_feed_token(text) to authenticated, service_role;
grant execute on function public.calendar_feed_events(text) to service_role;
