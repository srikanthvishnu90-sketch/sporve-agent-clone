-- Isolated regression fixture for 2026-09-06-agent-cron-hygiene.sql.
-- Run in a disposable PostgreSQL database as an owner; this file is not a
-- production migration and does not connect to Sporv.
begin;

create schema if not exists sporv_agent_cron_test;
create table sporv_agent_cron_test.providers(
  id uuid primary key,
  onboarding_completed boolean not null default false
);
create table sporv_agent_cron_test.provider_settings(
  provider_id uuid not null,
  key text not null,
  value jsonb not null,
  primary key(provider_id,key)
);

create or replace function sporv_agent_cron_test.agent_mode(p_provider uuid)
returns text language sql stable as $$
  select coalesce((select value->>'mode' from sporv_agent_cron_test.provider_settings
                   where provider_id=p_provider and key='agent_mode'),'draft');
$$;
create or replace function sporv_agent_cron_test.agent_read_on(p_provider uuid)
returns boolean language sql stable as $$
  select exists(select 1 from sporv_agent_cron_test.providers p
                where p.id=p_provider and p.onboarding_completed is true)
         and sporv_agent_cron_test.agent_mode(p_provider) in ('observe','draft');
$$;
create or replace function sporv_agent_cron_test.agent_autodraft_on(p_provider uuid)
returns boolean language sql stable as $$
  select exists(select 1 from sporv_agent_cron_test.providers p
                where p.id=p_provider and p.onboarding_completed is true)
         and sporv_agent_cron_test.agent_mode(p_provider)='draft';
$$;

insert into sporv_agent_cron_test.providers values
  ('00000000-0000-0000-0000-000000000001',false),
  ('00000000-0000-0000-0000-000000000002',true),
  ('00000000-0000-0000-0000-000000000003',true);
insert into sporv_agent_cron_test.provider_settings values
  ('00000000-0000-0000-0000-000000000001','agent_mode','{"mode":"draft"}'),
  ('00000000-0000-0000-0000-000000000002','agent_mode','{"mode":"observe"}'),
  ('00000000-0000-0000-0000-000000000003','agent_mode','{"mode":"draft"}');

do $$
begin
  if sporv_agent_cron_test.agent_read_on('00000000-0000-0000-0000-000000000001')
     or sporv_agent_cron_test.agent_autodraft_on('00000000-0000-0000-0000-000000000001') then
    raise exception 'onboarding-incomplete provider passed an agent gate';
  end if;
  if not sporv_agent_cron_test.agent_read_on('00000000-0000-0000-0000-000000000002')
     or sporv_agent_cron_test.agent_autodraft_on('00000000-0000-0000-0000-000000000002') then
    raise exception 'observe provider returned incorrect gates';
  end if;
  if not sporv_agent_cron_test.agent_read_on('00000000-0000-0000-0000-000000000003')
     or not sporv_agent_cron_test.agent_autodraft_on('00000000-0000-0000-0000-000000000003') then
    raise exception 'draft provider returned incorrect gates';
  end if;
end $$;

rollback;
