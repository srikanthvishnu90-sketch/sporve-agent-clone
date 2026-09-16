-- ============================================================================
-- 20260915_001070 — spec 12.6 publication · event reminders · 12.5 ICS feed.
-- Slice 3 of spec 12 (closes the spec). Single lane. Applied live on merge.
--
-- 12.6 — invisible until published_at; publish a series or a date range in
-- one action; publishing seeds an explicit 'no_response' RSVP per rostered
-- athlete so every count has a real denominator, and returns the conflicts
-- it found so the director sees them at publish time (12.3: warnings).
-- Unpublishing is refused by trg_event_guard (001052): cancel instead.
--
-- Reminders — tomorrow's published events, one obligations DRAFT per rostered
-- family, nightly; the same draft-first path as every other agent write.
--
-- 12.5 — per-guardian signed ICS feed. The URL is the credential: a 256-bit
-- token, one active per guardian, revocable, regenerable, never an org id.
-- calendar_feed_events(token) is the ONLY read path (service_role EXECUTE) and
-- returns nothing for a missing or revoked token. It emits team + title, the
-- venue, and the arrival offset — never an athlete name, never staff notes.
-- A token dies with the guardian (FK cascade) and is revoked the moment the
-- guardian's last roster link in the org is removed.
--
-- Housekeeping filed here so repo and production stay one thing:
--   · agent_vocab (live since 2026-09-04, called by 001020/001023, never in a
--     migration) is defined below exactly as it exists live.
--   · the 001069 trigger function carried Postgres's default EXECUTE for anon.
-- ============================================================================

-- ── housekeeping ───────────────────────────────────────────────────────────
create or replace function public.agent_vocab(p_provider uuid, p_key text, p_default text)
returns text language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select value->>p_key from public.provider_settings
     where provider_id = p_provider and key = 'vocab'), p_default);
$$;
revoke all on function public.agent_vocab(uuid,text,text) from public, anon;
grant execute on function public.agent_vocab(uuid,text,text) to authenticated, service_role;
revoke all on function public.draft_event_change_notices() from public, anon, authenticated;

-- ── 12.6 publication ───────────────────────────────────────────────────────
create or replace function public.seed_no_response(p_event uuid) returns integer
language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  insert into public.event_response (provider_id, event_id, member_id, response, source)
  select e.provider_id, e.id, ta.id, 'no_response', 'staff'
  from public.event e join public.team_athletes ta on ta.team_id = e.team_id and ta.status = 'active'
  where e.id = p_event
  on conflict (event_id, member_id) do nothing;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.seed_no_response(uuid) from public, anon, authenticated;

create or replace function public.publish_series(p_series uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r record; n int := 0; v_provider uuid; v_from timestamptz; v_to timestamptz; v_conf jsonb;
begin
  select provider_id into v_provider from public.event_series where id = p_series;
  if v_provider is null then raise exception 'series not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not public.is_org_admin(v_provider) then
    raise exception 'only organisation staff may publish' using errcode = '42501';
  end if;
  for r in update public.event set published_at = now()
           where series_id = p_series and published_at is null and status <> 'cancelled' returning id loop
    perform public.seed_no_response(r.id); n := n + 1;
  end loop;
  select min(starts_at), max(ends_at) into v_from, v_to from public.event where series_id = p_series and status <> 'cancelled';
  select coalesce(jsonb_agg(jsonb_build_object('event_id', c.event_id, 'conflict', c.conflict, 'other_id', c.other_id, 'detail', c.detail)), '[]'::jsonb)
    into v_conf from public.event_conflicts_in_range(v_provider, coalesce(v_from, now()), coalesce(v_to, now())) c
    where c.event_id in (select id from public.event where series_id = p_series);
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (v_provider, 'schedule', 'series_published', jsonb_build_object('series_id', p_series, 'events', n, 'conflicts', jsonb_array_length(v_conf)), auth.uid());
  return jsonb_build_object('published', n, 'conflicts', v_conf);
end $$;

create or replace function public.publish_events(p_provider uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare r record; n int := 0; v_conf jsonb;
begin
  if auth.uid() is not null and not public.is_org_admin(p_provider) then
    raise exception 'only organisation staff may publish' using errcode = '42501';
  end if;
  if p_to < p_from then raise exception 'the range ends before it starts' using errcode = '22023'; end if;
  for r in update public.event set published_at = now()
           where provider_id = p_provider and published_at is null and status <> 'cancelled'
             and (starts_at at time zone timezone)::date between p_from and p_to returning id loop
    perform public.seed_no_response(r.id); n := n + 1;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('event_id', c.event_id, 'conflict', c.conflict, 'other_id', c.other_id, 'detail', c.detail)), '[]'::jsonb)
    into v_conf from public.event_conflicts_in_range(p_provider, p_from::timestamptz - interval '1 day', p_to::timestamptz + interval '2 days') c;
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (p_provider, 'schedule', 'range_published', jsonb_build_object('from', p_from, 'to', p_to, 'events', n, 'conflicts', jsonb_array_length(v_conf)), auth.uid());
  return jsonb_build_object('published', n, 'conflicts', v_conf);
end $$;
revoke all on function public.publish_series(uuid) from public, anon;
revoke all on function public.publish_events(uuid,date,date) from public, anon;
grant execute on function public.publish_series(uuid), public.publish_events(uuid,date,date) to authenticated, service_role;

-- ── reminders (draft-first) ────────────────────────────────────────────────
create or replace function public.generate_event_reminders(
  p_provider uuid default null, p_force boolean default false, p_run uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted integer := 0; v_run uuid := coalesce(p_run, gen_random_uuid());
begin
  insert into public.obligations
    (provider_id, kind, status, title, detail, due_at, source_kind, source_ref,
     inverse, member_id, guardian_id, run_id, draft_type)
  select e.provider_id, 'schedule', 'draft',
    'Tomorrow — ' || e.title,
    'Hi ' || coalesce(r.first_name,'there') || ' — reminder: ' || e.title || ' is tomorrow at '
      || to_char(e.starts_at at time zone e.timezone, 'HH12:MI AM')
      || coalesce(', ' || e.location_text, '')
      || case when e.arrival_offset_minutes > 0 then ' (arrive ' || e.arrival_offset_minutes || ' min early)' else '' end || '.',
    e.starts_at, 'agent',
    'event:' || e.id || ':reminder:member:' || r.member_id,
    jsonb_build_object('action','void','reason','undo event reminder'),
    r.member_id, r.guardian_id, v_run, 'event_reminder'
  from public.event e
  cross join lateral public.event_family_recipients(e.id) r
  where e.published_at is not null and e.status = 'scheduled'
    and (e.starts_at at time zone e.timezone)::date = current_date + 1
    and (p_provider is null or e.provider_id = p_provider)
    and (p_force or public.agent_autodraft_on(e.provider_id))
  on conflict (source_ref) where source_kind = 'agent' and status <> 'void' do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function public.generate_event_reminders(uuid,boolean,uuid) from public, anon, authenticated;
grant execute on function public.generate_event_reminders(uuid,boolean,uuid) to service_role;

-- ── 12.5 calendar feed ─────────────────────────────────────────────────────
create table if not exists public.calendar_feed_tokens (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  token        text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  constraint calendar_feed_token_hex check (token ~ '^[0-9a-f]{64}$')
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
  if not exists (select 1 from public.guardian_links gl join public.team_athletes ta on ta.id = gl.member_id
                 where gl.guardian_id = p_guardian and ta.status = 'active') then
    raise exception 'this guardian has no rostered athlete to build a calendar for' using errcode = '22023';
  end if;
  update public.calendar_feed_tokens set revoked_at = now() where guardian_id = p_guardian and revoked_at is null;
  insert into public.calendar_feed_tokens (provider_id, guardian_id) values (v_provider, p_guardian)
    returning token into v_token;
  insert into public.settings_audit (provider_id, surface, key, new_value, changed_by)
  values (v_provider, 'schedule', 'feed_token_issued', jsonb_build_object('guardian_id', p_guardian), auth.uid());
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

-- a guardian whose LAST roster link in the org goes away loses the feed at once
create or replace function public.revoke_feed_on_unlink() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if not exists (select 1 from public.guardian_links gl join public.team_athletes ta on ta.id = gl.member_id
                 where gl.guardian_id = old.guardian_id and ta.status = 'active' and gl.id <> old.id) then
    update public.calendar_feed_tokens set revoked_at = now() where guardian_id = old.guardian_id and revoked_at is null;
  end if;
  return old;
end $$;
revoke all on function public.revoke_feed_on_unlink() from public, anon, authenticated;
drop trigger if exists trg_revoke_feed_on_unlink on public.guardian_links;
create trigger trg_revoke_feed_on_unlink after delete on public.guardian_links
  for each row execute function public.revoke_feed_on_unlink();

create or replace function public.calendar_feed_events(p_token text)
returns table (uid uuid, sequence integer, status text, summary text, starts_at timestamptz, ends_at timestamptz,
               location text, description text, calname text, arrival_offset_minutes integer)
language plpgsql security definer set search_path to '' as $$
declare t public.calendar_feed_tokens;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return; end if;               -- malformed: zero rows, no lookup
  select * into t from public.calendar_feed_tokens where token = p_token and revoked_at is null;
  if not found then return; end if;                                   -- missing or revoked: zero rows
  update public.calendar_feed_tokens set last_used_at = now() where id = t.id;
  return query
  select e.id, e.sequence,
         case e.status when 'cancelled' then 'CANCELLED' else 'CONFIRMED' end,
         coalesce(tm.name || ' — ', '') || e.title,                 -- team + title: no athlete name, ever
         e.starts_at, e.ends_at,
         coalesce(v.address, v.name, e.location_text),
         case when e.arrival_offset_minutes > 0 then 'Arrive ' || e.arrival_offset_minutes || ' min early.' else '' end,
         p.business_name, e.arrival_offset_minutes                    -- staff notes are NOT in the feed (they may name a child)
  from public.event e
  join public.providers p on p.id = e.provider_id
  left join public.teams tm on tm.id = e.team_id
  left join public.venue v on v.id = e.venue_id
  where e.provider_id = t.provider_id and e.published_at is not null
    and exists (select 1 from public.guardian_links gl join public.team_athletes ta on ta.id = gl.member_id
                where gl.guardian_id = t.guardian_id and ta.status = 'active' and ta.team_id = e.team_id)
  order by e.starts_at;
end $$;
revoke all on function public.issue_calendar_feed_token(uuid), public.revoke_calendar_feed_token(text),
              public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.issue_calendar_feed_token(uuid), public.revoke_calendar_feed_token(text) to authenticated, service_role;
grant execute on function public.calendar_feed_events(text) to service_role;

-- ── nightly jobs (guarded: pg_cron is absent on a scratch database) ────────
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- the 180-day horizon roll for series (001066 defined the materializer, nothing scheduled it)
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-materialize-series';
    perform cron.schedule('sporv-materialize-series', '10 3 * * *', 'select public.materialize_all_series(180);');
    perform cron.unschedule(jobid) from cron.job where jobname = 'sporv-event-reminders';
    perform cron.schedule('sporv-event-reminders', '30 3 * * *', 'select public.generate_event_reminders();');
  end if;
end $$;
