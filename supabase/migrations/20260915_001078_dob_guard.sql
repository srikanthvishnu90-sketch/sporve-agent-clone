-- ============================================================================
-- 20260915_001078 — audit 2026-09-17 P2-2: no date-of-birth validation.
-- A birthdate of 1899-01-01 and one of tomorrow were stored without complaint
-- (no CHECK, no client check). The import wizard now rejects them; this makes
-- the database refuse them from ANY writer — a future date, or one before
-- 1920, raises 23514 with a message a person can read. Existing rows are not
-- rewritten: the guard fires on insert and on any update that touches the
-- column, so a bad row already in place is corrected the next time it is
-- edited and never silently accepted again. Null stays allowed (unknown ≠
-- impossible). Applies to team_athletes.dob and athletes.date_of_birth.
-- ============================================================================
create or replace function public.dob_guard() returns trigger
language plpgsql set search_path to '' as $$
declare v date;
begin
  v := case TG_TABLE_NAME when 'team_athletes' then (to_jsonb(new) ->> 'dob')::date else (to_jsonb(new) ->> 'date_of_birth')::date end;
  if v is null then return new; end if;
  if v > current_date then
    raise exception 'date of birth % is in the future', v using errcode = '23514';
  end if;
  if v < date '1920-01-01' then
    raise exception 'date of birth % is before 1920', v using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_team_athletes_dob_guard on public.team_athletes;
create trigger trg_team_athletes_dob_guard before insert or update of dob on public.team_athletes
  for each row execute function public.dob_guard();
do $$ begin
  if to_regclass('public.athletes') is not null and exists (select 1 from information_schema.columns where table_schema='public' and table_name='athletes' and column_name='date_of_birth') then
    execute 'drop trigger if exists trg_athletes_dob_guard on public.athletes';
    execute 'create trigger trg_athletes_dob_guard before insert or update of date_of_birth on public.athletes for each row execute function public.dob_guard()';
  end if;
end $$;
revoke all on function public.dob_guard() from public, anon;
