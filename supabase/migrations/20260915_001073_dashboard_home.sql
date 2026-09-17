-- ============================================================================
-- 20260915_001073 — doc 25/26/27 slice 1 · the home screen as DATA.
-- Single lane. Applied live on merge.
--
-- What this is: a registry of home-screen blocks (dashboard_block), a seeded
-- default block list per role (dashboard_role_default), a per-member layout
-- table for later explicit choices (dashboard_layout — no UI writes it yet,
-- deliberately), six capability flags DERIVED at render (never stored), and
-- ONE SECURITY DEFINER RPC, dashboard_home(p_provider), that resolves the
-- caller's block list and returns every block's rows in a single round trip.
--
-- Resolution (25.5): role default → profile refinement (flags) → user layout
-- → permission filter LAST. A stored layout naming a block the member may not
-- see resolves to a list without it: no error, no leak. An unknown key drops.
--
-- Permission is proven by ZERO ROWS (doc 28 law 2): every block query in
-- dashboard_home() is scoped by the caller's resolved role and org inside
-- SQL; a coach asking for money.overdue gets the block absent from the list
-- AND, if a stored layout names it, zero rows — never an exception. A
-- non-member gets an empty result, not an error. No component filters.
--
-- Role mapping (premise check 2026-09-17): the repo's org roles are
-- owner | admin | trainer (organization_members_role_check) plus the org
-- OWNER (providers.owner_id). Doc 26.5 names owner/director/treasurer/
-- registrar/coach. Mapping is data, not a column change:
--   providers.owner_id  → 'owner'      admin → 'director'      trainer → 'coach'
-- treasurer and registrar defaults are seeded for when those roles exist
-- (spec 21); nothing maps to them today. Rank order for min_role:
--   coach 1 < registrar 2 = treasurer 2 < director 3 < owner 4.
--
-- Blocks that are real today: money.overdue (obligations kind='fee' past
-- due_at, not done/void), schedule.today (event + event_conflicts_in_range),
-- agent.attention (agent_findings open + obligations agent drafts — THE SAME
-- ROWS THE QUEUE READS; doc 26 says outbound_messages drafts, but this repo's
-- approval inbox is obligations, and the audit's rule is the two must never
-- disagree), roster.gaps (team_athletes with no signature on an org waiver
-- document ∪ background_check / staff_certifications expiring in the window).
-- people.recent is registered but requires runs_registration, which derives
-- from registration forms that do not exist yet (spec 13.7) — so it is
-- absent from every resolved list today, honestly. rents_facilities cannot
-- be derived (venue carries no ownership) and is false. No block writes.
-- ============================================================================

-- ── registry ───────────────────────────────────────────────────────────────
create table if not exists public.dashboard_block (
  key             text primary key,
  title           text not null,
  description     text not null,
  min_role        text not null check (min_role in ('coach','registrar','treasurer','director','owner')),
  requires        text[] not null default '{}',
  params_schema   jsonb,
  default_params  jsonb not null default '{}',
  empty_text      text not null,
  error_text      text not null,
  drill_to        text not null,
  created_at      timestamptz not null default now()
);
create table if not exists public.dashboard_role_default (
  role    text primary key check (role in ('owner','director','treasurer','registrar','coach')),
  blocks  jsonb not null default '[]'
);
create table if not exists public.dashboard_layout (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  member_id    uuid not null references public.organization_members(id) on delete cascade,
  blocks       jsonb not null default '[]',      -- [{key, params, position}]
  source       text not null default 'role_default' check (source in ('role_default','profile','user','suggested')),
  updated_at   timestamptz not null default now(),
  unique (provider_id, member_id)
);
alter table public.dashboard_block enable row level security;
alter table public.dashboard_block force row level security;
alter table public.dashboard_role_default enable row level security;
alter table public.dashboard_role_default force row level security;
alter table public.dashboard_layout enable row level security;
alter table public.dashboard_layout force row level security;
revoke all on public.dashboard_block, public.dashboard_role_default, public.dashboard_layout from public, anon, authenticated;
-- the registry is readable by any signed-in staff member (it holds no org data); layouts are RPC-only
grant select on public.dashboard_block, public.dashboard_role_default to authenticated;
drop policy if exists dashboard_block_read on public.dashboard_block;
create policy dashboard_block_read on public.dashboard_block for select to authenticated using (true);
drop policy if exists dashboard_role_default_read on public.dashboard_role_default;
create policy dashboard_role_default_read on public.dashboard_role_default for select to authenticated using (true);

-- ── seed: the five CORE blocks (26.2) and the role defaults (26.5) — idempotent ──
insert into public.dashboard_block (key, title, description, min_role, requires, params_schema, default_params, empty_text, error_text, drill_to) values
  ('money.overdue',   'Outstanding balances', 'Families with a balance past due, aged, largest and oldest first.', 'treasurer', '{collects_dues}',
     '{"type":"object","properties":{"agedOverDays":{"type":"integer","minimum":0}}}', '{"agedOverDays":14}',
     'Nobody owes anything right now.', 'Could not load balances.', 'finances'),
  ('schedule.today',  'Today and tomorrow', 'Events in the next 48 hours with any unresolved conflict flagged on the event.', 'coach', '{}',
     '{"type":"object","properties":{}}', '{}',
     'Nothing scheduled in the next two days.', 'Could not load the schedule.', 'schedule'),
  ('agent.attention', 'Needs you', 'Findings not dismissed and drafts awaiting your approval, newest first.', 'coach', '{}',
     '{"type":"object","properties":{}}', '{}',
     'The agent is watching your inbox and your schedule. Nothing needs you.', 'Could not load the agent''s queue.', 'queue'),
  ('roster.gaps',     'Roster gaps', 'Athletes missing a required waiver, and staff whose background check or certification expires soon.', 'registrar', '{}',
     '{"type":"object","properties":{"expiryWindowDays":{"type":"integer","minimum":1}}}', '{"expiryWindowDays":60}',
     'Every athlete and every staff member is current.', 'Could not load roster gaps.', 'roster'),
  ('people.recent',   'Roster changes', 'Registrations, withdrawals and waitlist movement in the last 14 days.', 'registrar', '{runs_registration}',
     '{"type":"object","properties":{}}', '{}',
     'No roster changes in the last two weeks.', 'Could not load recent changes.', 'roster')
on conflict (key) do nothing;

insert into public.dashboard_role_default (role, blocks) values
  ('owner',     '["agent.attention","money.overdue","schedule.today","roster.gaps","people.recent"]'),
  ('director',  '["agent.attention","schedule.today","roster.gaps","people.recent"]'),
  ('treasurer', '["money.overdue","agent.attention"]'),
  ('registrar', '["roster.gaps","people.recent","agent.attention"]'),
  ('coach',     '["schedule.today","agent.attention"]')
on conflict (role) do nothing;

-- ── who is asking (25.5 step 4 depends on this) ────────────────────────────
create or replace function public.dashboard_role_rank(p_role text) returns integer
language sql immutable set search_path to '' as $$
  select case p_role when 'coach' then 1 when 'registrar' then 2 when 'treasurer' then 2 when 'director' then 3 when 'owner' then 4 else 0 end
$$;
revoke all on function public.dashboard_role_rank(text) from public, anon;

-- resolves the caller to (role, member_id) for this org; null role = not a member
create or replace function public.dashboard_caller(p_provider uuid, out role text, out member_id uuid)
language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_row record;
begin
  role := null; member_id := null;
  if v_uid is null then return; end if;
  if exists (select 1 from public.providers p where p.id = p_provider and p.owner_id = v_uid) then
    role := 'owner';
    select m.id into member_id from public.organization_members m where m.organization_id = p_provider and m.member_user_id = v_uid and m.is_active limit 1;
    return;
  end if;
  select m.id, m.role into v_row from public.organization_members m
   where m.organization_id = p_provider and m.member_user_id = v_uid and m.is_active limit 1;
  if v_row.id is null then return; end if;
  member_id := v_row.id;
  role := case v_row.role when 'owner' then 'owner' when 'admin' then 'director' when 'trainer' then 'coach' else null end;
end $$;
revoke all on function public.dashboard_caller(uuid) from public, anon, authenticated;

-- ── capability flags (27.3): live counts, never stored ─────────────────────
create or replace function public.dashboard_flags(p_provider uuid) returns jsonb
language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'has_staff',           (select count(*) from public.organization_members m where m.organization_id = p_provider and m.is_active) > 1,
    'rents_facilities',    false,   -- venue carries no ownership today; deriving would be a guess (27.3: never a stored answer)
    'collects_dues',       exists (select 1 from public.obligations o where o.provider_id = p_provider and o.kind = 'fee'),
    'runs_registration',   false,   -- registration forms are spec 13.7; nothing exists to count
    'multi_team',          (select count(*) from public.teams t where t.provider_id = p_provider) > 1,
    'has_connected_inbox', exists (select 1 from public.org_connectors c where c.provider_id = p_provider and c.kind = 'gmail' and c.status::text in ('connected','active'))
  )
$$;
revoke all on function public.dashboard_flags(uuid) from public, anon, authenticated;

-- ── resolution (25.5): default → refinement → user layout → permission filter ──
create or replace function public.dashboard_resolve(p_role text, p_flags jsonb, p_layout jsonb default null)
returns jsonb language plpgsql stable set search_path to '' as $$
declare v_keys jsonb; v_out jsonb := '[]'::jsonb; v_item jsonb; v_key text; v_params jsonb; b record; ok boolean; req text;
begin
  if p_role is null then return '[]'::jsonb; end if;
  -- 3. an explicit user layout wins over the role default (1) …
  if p_layout is not null and jsonb_typeof(p_layout) = 'array' and jsonb_array_length(p_layout) > 0 then
    v_keys := p_layout;
  else
    select coalesce(d.blocks, '[]'::jsonb) into v_keys from public.dashboard_role_default d where d.role = p_role;
    v_keys := coalesce(v_keys, '[]'::jsonb);
  end if;
  -- 2 + 4. refinement and the permission filter, applied to whichever list won
  for v_item in select * from jsonb_array_elements(v_keys) loop
    v_key := case when jsonb_typeof(v_item) = 'string' then v_item #>> '{}' else v_item ->> 'key' end;
    v_params := case when jsonb_typeof(v_item) = 'object' then coalesce(v_item -> 'params', '{}'::jsonb) else '{}'::jsonb end;
    select * into b from public.dashboard_block where key = v_key;
    if b.key is null then continue; end if;                                       -- unknown key: dropped
    if public.dashboard_role_rank(p_role) < public.dashboard_role_rank(b.min_role) then continue; end if;  -- permission filter
    ok := true;
    foreach req in array b.requires loop
      if coalesce((p_flags ->> req)::boolean, false) is not true then ok := false; end if;  -- profile refinement: a capability the org lacks
    end loop;
    if not ok then continue; end if;
    v_out := v_out || jsonb_build_object('key', b.key, 'params', b.default_params || v_params);
  end loop;
  return v_out;
end $$;
revoke all on function public.dashboard_resolve(text, jsonb, jsonb) from public, anon;
grant execute on function public.dashboard_resolve(text, jsonb, jsonb) to authenticated, service_role;

-- ── the home screen, one round trip ────────────────────────────────────────
create or replace function public.dashboard_home(p_provider uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_member uuid; v_flags jsonb; v_layout jsonb; v_list jsonb; v_item jsonb; v_key text; v_params jsonb;
        v_rows jsonb; v_blocks jsonb := '[]'::jsonb; b record; v_now timestamptz := now(); v_err text;
begin
  select role, member_id into v_role, v_member from public.dashboard_caller(p_provider);
  if v_role is null then
    -- not a member of this org: an EMPTY home, not an error (doc 28 law 2)
    return jsonb_build_object('role', null, 'flags', '{}'::jsonb, 'blocks', '[]'::jsonb);
  end if;
  v_flags := public.dashboard_flags(p_provider);
  if v_member is not null then
    select l.blocks into v_layout from public.dashboard_layout l where l.provider_id = p_provider and l.member_id = v_member;
  end if;
  v_list := public.dashboard_resolve(v_role, v_flags, v_layout);
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_key := v_item ->> 'key'; v_params := coalesce(v_item -> 'params', '{}'::jsonb);
    select * into b from public.dashboard_block where key = v_key;
    v_rows := '[]'::jsonb; v_err := null;
    begin
    if v_key = 'money.overdue' and public.dashboard_role_rank(v_role) >= 2 then
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'amount_cents', o.amount_cents, 'due_at', o.due_at,
               'days_overdue', floor(extract(epoch from (v_now - o.due_at)) / 86400)::int,
               'family', nullif(trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')), ''))
             order by o.due_at asc, o.amount_cents desc), '[]'::jsonb)
        into v_rows
        from (select * from public.obligations o where o.provider_id = p_provider and o.kind = 'fee' and o.status in ('draft','approved')
                and o.amount_cents > 0 and o.due_at is not null
                and o.due_at <= v_now - make_interval(days => coalesce((v_params ->> 'agedOverDays')::int, 0))
              order by o.due_at asc, o.amount_cents desc limit 25) o
        left join public.guardians g on g.id = o.guardian_id;
    elsif v_key = 'schedule.today' then
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
               'timezone', e.timezone, 'team', tm.name, 'venue', coalesce(v.name, e.location_text),
               'conflicts', (select coalesce(jsonb_agg(jsonb_build_object('conflict', c.conflict, 'detail', c.detail)), '[]'::jsonb)
                             from public.detect_event_conflicts(e.id) c))
             order by e.starts_at), '[]'::jsonb)
        into v_rows
        from (select * from public.event e where e.provider_id = p_provider and e.status <> 'cancelled'
                and e.starts_at >= v_now - interval '1 hour' and e.starts_at < v_now + interval '48 hours'
                and (v_role <> 'coach' or e.assigned_member_id is null or e.assigned_member_id = v_member)
              order by e.starts_at limit 25) e
        left join public.teams tm on tm.id = e.team_id
        left join public.venue v on v.id = e.venue_id;
    elsif v_key = 'agent.attention' then
      -- the SAME rows the Queue tab reads: agent_findings open + agent drafts in obligations
      select coalesce(jsonb_agg(x order by (x ->> 'created_at') desc), '[]'::jsonb) into v_rows from (
        select jsonb_build_object('kind', 'finding', 'id', f.id, 'title', f.title, 'detail', f.detail, 'severity', f.severity, 'created_at', f.created_at) x
          from public.agent_findings f where f.provider_id = p_provider and f.status = 'open'
        union all
        select jsonb_build_object('kind', 'draft', 'id', o.id, 'title', o.title, 'detail', o.detail, 'draft_type', o.draft_type, 'created_at', o.created_at)
          from public.obligations o where o.provider_id = p_provider and o.status = 'draft' and o.source_kind = 'agent'
        order by 1 desc limit 25) s;
    elsif v_key = 'roster.gaps' and public.dashboard_role_rank(v_role) >= 2 then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
        -- athletes with no signature on any of the org's waiver documents (when the org has any)
        select jsonb_build_object('kind', 'waiver', 'id', ta.id, 'name', trim(coalesce(ta.first_name,'') || ' ' || coalesce(ta.last_name,'')), 'detail', 'no signed waiver on file') x
          from public.team_athletes ta
         where ta.provider_id = p_provider and ta.status = 'active'
           and exists (select 1 from public.waiver_documents d where d.provider_id = p_provider)
           and not exists (select 1 from public.waiver_signatures s join public.waiver_documents d on d.id = s.waiver_document_id
                            where s.member_id = ta.id and d.provider_id = p_provider)
        union all
        select jsonb_build_object('kind', 'staff', 'id', bc.id, 'name', 'Background check', 'detail', 'expires ' || to_char(bc.expires_at, 'Mon DD'), 'expires_at', bc.expires_at)
          from public.background_check bc
         where bc.provider_id = p_provider and bc.expires_at is not null
           and bc.expires_at <= v_now + make_interval(days => coalesce((v_params ->> 'expiryWindowDays')::int, 60))
        union all
        select jsonb_build_object('kind', 'staff', 'id', sc.id, 'name', sc.kind, 'detail', 'expires ' || to_char(sc.expires_at, 'Mon DD'), 'expires_at', sc.expires_at)
          from public.staff_certifications sc
         where sc.organization_id = p_provider and sc.expires_at is not null
           and sc.expires_at <= v_now + make_interval(days => coalesce((v_params ->> 'expiryWindowDays')::int, 60))
        limit 25) s;
    elsif v_key = 'people.recent' and public.dashboard_role_rank(v_role) >= 2 then
      select coalesce(jsonb_agg(jsonb_build_object('kind', 'registered', 'id', ta.id, 'name', trim(coalesce(ta.first_name,'') || ' ' || coalesce(ta.last_name,'')), 'at', ta.created_at)
             order by ta.created_at desc), '[]'::jsonb)
        into v_rows
        from (select * from public.team_athletes ta where ta.provider_id = p_provider and ta.created_at >= v_now - interval '14 days' order by ta.created_at desc limit 25) ta;
    end if;
    exception when others then
      -- one block's failure is THAT block's error state; every other block still renders (doc 28 law 4)
      v_err := b.error_text; v_rows := '[]'::jsonb;
    end;
    v_blocks := v_blocks || jsonb_build_object('key', b.key, 'title', b.title, 'description', b.description, 'params', v_params,
                                               'empty', b.empty_text, 'error', b.error_text, 'drill_to', b.drill_to, 'rows', v_rows,
                                               'failed', v_err is not null);
  end loop;
  return jsonb_build_object('role', v_role, 'flags', v_flags, 'blocks', v_blocks);
end $$;
revoke all on function public.dashboard_home(uuid) from public, anon;
grant execute on function public.dashboard_home(uuid) to authenticated, service_role;
