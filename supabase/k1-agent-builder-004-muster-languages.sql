-- K1 Agent Builder — migration 004
-- Adds: Finnish and Swedish versions of the opener and reminders, and moves uploaded
-- leads to the Muster API shape. Run after 003. Safe to run more than once.

-- 1. Language versions of the opener and reminders --------------------------------
-- Shape: { "fi": { "opener": "...", "reminders": [{ "text": "..." }, ...] }, "sv": { ... } }
-- Reminder timing always comes from the English reminders.

alter table public.agent_builder_versions
  add column if not exists reminders jsonb not null default '[]'::jsonb,
  add column if not exists translations jsonb not null default '{}'::jsonb;

drop function if exists public.save_agent_builder_version(text, text, text, text, boolean, text, text);
drop function if exists public.save_agent_builder_version(text, text, text, text, boolean, text, text, jsonb);

create or replace function public.save_agent_builder_version(
  p_tenant_key text,
  p_master_prompt text,
  p_opening_message text,
  p_additional_information text default '',
  p_locked boolean default false,
  p_note text default '',
  p_saved_by text default null,
  p_reminders jsonb default '[]'::jsonb,
  p_translations jsonb default '{}'::jsonb
)
returns table (version_id uuid, version_number integer, active_version_id uuid, locked boolean)
language plpgsql
security invoker
as $$
declare
  target_agent public.agent_builder_agents%rowtype;
  next_version integer;
  inserted_version_id uuid;
begin
  select * into target_agent from public.agent_builder_agents where tenant_key = p_tenant_key;
  if not found then
    insert into public.agent_builder_agents (tenant_key, display_name, locked)
    values (p_tenant_key, 'K1 Katsastus', false)
    returning * into target_agent;
  end if;

  select coalesce(max(v.version_number), 0) + 1 into next_version
  from public.agent_builder_versions v where v.agent_id = target_agent.id;

  insert into public.agent_builder_versions (
    agent_id, version_number, is_active, master_prompt, additional_information,
    opening_message, note, saved_by, reminders, translations
  )
  values (
    target_agent.id, next_version, false, p_master_prompt, p_additional_information,
    p_opening_message, coalesce(p_note, ''), p_saved_by,
    case when jsonb_typeof(p_reminders) = 'array' then p_reminders else '[]'::jsonb end,
    case when jsonb_typeof(p_translations) = 'object' then p_translations else '{}'::jsonb end
  )
  returning id into inserted_version_id;

  update public.agent_builder_versions set is_active = false
  where agent_id = target_agent.id and id <> inserted_version_id;
  update public.agent_builder_versions set is_active = true where id = inserted_version_id;

  update public.agent_builder_agents
  set active_version_id = inserted_version_id, locked = p_locked
  where id = target_agent.id;

  return query select inserted_version_id, next_version, inserted_version_id, p_locked;
end;
$$;

-- 2. Leads in the Muster API shape --------------------------------------------------
-- StationName, isClosed, PlateNumber, Product, NextInspectionDateRangeEnd,
-- PhoneNumber, Language, LastInspection, Reason.

create table if not exists public.agent_builder_leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  registration text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_builder_leads
  add column if not exists name text not null default '',
  add column if not exists email text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists inspection_due date null,
  add column if not exists source text not null default 'csv',
  add column if not exists station_name text not null default '',
  add column if not exists is_closed boolean not null default false,
  add column if not exists product text not null default '',
  add column if not exists language text not null default '',
  add column if not exists last_inspection date null,
  add column if not exists reason text not null default '';

alter table public.agent_builder_leads alter column name set default '';
alter table public.agent_builder_leads alter column name drop not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_builder_leads' and column_name = 'registration_key'
  ) then
    alter table public.agent_builder_leads
      add column registration_key text generated always as (upper(regexp_replace(registration, '[\s-]', '', 'g'))) stored;
  end if;
end $$;

create unique index if not exists agent_builder_leads_registration_uidx
  on public.agent_builder_leads (agent_id, registration_key);

alter table public.agent_builder_leads enable row level security;

-- Re-uploading the same plate number updates that lead instead of duplicating it.
create or replace function public.import_leads(p_tenant_key text, p_rows jsonb)
returns table (inserted integer, updated integer)
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_must_be_an_array'; end if;

  return query
  with incoming as (
    select distinct on (upper(regexp_replace(trim(r."PlateNumber"), '[\s-]', '', 'g')))
      coalesce(trim(r."StationName"), '') as station_name,
      coalesce(r."isClosed", false) as is_closed,
      trim(r."PlateNumber") as registration,
      coalesce(trim(r."Product"), '') as product,
      case when coalesce(trim(r."NextInspectionDateRangeEnd"), '') ~ '^\d{4}-\d{2}-\d{2}' then left(trim(r."NextInspectionDateRangeEnd"), 10)::date end as inspection_due,
      coalesce(trim(r."PhoneNumber"), '') as phone,
      coalesce(trim(r."Language"), '') as language,
      case when coalesce(trim(r."LastInspection"), '') ~ '^\d{4}-\d{2}-\d{2}' then left(trim(r."LastInspection"), 10)::date end as last_inspection,
      coalesce(trim(r."Reason"), '') as reason
    from jsonb_to_recordset(p_rows) as r(
      "StationName" text, "isClosed" boolean, "PlateNumber" text, "Product" text,
      "NextInspectionDateRangeEnd" text, "PhoneNumber" text, "Language" text,
      "LastInspection" text, "Reason" text
    )
    where coalesce(trim(r."PlateNumber"), '') <> ''
    order by upper(regexp_replace(trim(r."PlateNumber"), '[\s-]', '', 'g'))
  ),
  written as (
    insert into public.agent_builder_leads as l (
      agent_id, registration, station_name, is_closed, product, inspection_due, phone, language, last_inspection, reason, source
    )
    select target_agent_id, i.registration, i.station_name, i.is_closed, i.product, i.inspection_due, i.phone, i.language, i.last_inspection, i.reason, 'csv'
    from incoming i
    on conflict (agent_id, registration_key) do update
      set registration = excluded.registration, station_name = excluded.station_name, is_closed = excluded.is_closed,
          product = excluded.product, inspection_due = excluded.inspection_due, phone = excluded.phone,
          language = excluded.language, last_inspection = excluded.last_inspection, reason = excluded.reason,
          updated_at = now()
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new)::integer, count(*) filter (where not is_new)::integer from written;
end;
$$;

create or replace function public.list_leads(p_tenant_key text)
returns json
language sql
stable
security invoker
as $$
  select coalesce(json_agg(json_build_object(
    'id', l.id,
    'stationName', l.station_name,
    'isClosed', l.is_closed,
    'plateNumber', l.registration,
    'product', l.product,
    'nextInspection', l.inspection_due,
    'phoneNumber', l.phone,
    'language', l.language,
    'lastInspection', l.last_inspection,
    'reason', l.reason,
    'createdAt', l.created_at
  ) order by l.created_at desc, l.registration), '[]'::json)
  from public.agent_builder_leads l
  join public.agent_builder_agents a on a.id = l.agent_id
  where a.tenant_key = p_tenant_key;
$$;

-- 3. State includes each version's language versions ---------------------------------

create or replace function public.get_agent_builder_state(p_tenant_key text)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'tenantKey', a.tenant_key,
    'displayName', a.display_name,
    'locked', a.locked,
    'activeVersionId', a.active_version_id,
    'liveVersionId', a.live_version_id,
    'liveSince', a.live_since,
    'liveBy', a.live_by,
    'versions', coalesce((
      select json_agg(json_build_object(
        'id', v.id,
        'versionNumber', v.version_number,
        'masterPrompt', v.master_prompt,
        'additionalInformation', v.additional_information,
        'openingMessage', v.opening_message,
        'reminders', v.reminders,
        'translations', v.translations,
        'note', v.note,
        'savedBy', v.saved_by,
        'createdAt', v.created_at,
        'isActive', v.is_active,
        'thumbsUp', coalesce(f.up, 0),
        'thumbsDown', coalesce(f.down, 0),
        'conversations', coalesce(f.conversations, 0)
      ) order by v.version_number desc)
      from public.agent_builder_versions v
      left join (
        select c.version_id,
          count(distinct c.id) as conversations,
          count(m.id) filter (where m.feedback = 'up') as up,
          count(m.id) filter (where m.feedback = 'down') as down
        from public.agent_builder_test_conversations c
        left join public.agent_builder_test_messages m on m.conversation_id = c.id
        where not c.is_draft
        group by c.version_id
      ) f on f.version_id = v.id
      where v.agent_id = a.id
    ), '[]'::json),
    'deployRequests', coalesce((
      select json_agg(json_build_object(
        'id', r.id,
        'versionId', r.version_id,
        'versionNumber', r.version_number,
        'requestedBy', r.requested_by,
        'goLive', r.go_live,
        'notes', r.notes,
        'status', r.status,
        'createdAt', r.created_at,
        'deployedAt', r.deployed_at,
        'deployedBy', r.deployed_by
      ) order by r.created_at desc)
      from (select * from public.agent_builder_deploy_requests r0 where r0.agent_id = a.id order by r0.created_at desc limit 20) r
    ), '[]'::json)
  )
  from public.agent_builder_agents a
  where a.tenant_key = p_tenant_key;
$$;
