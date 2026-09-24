-- K1 Agent Builder — migration 003
-- Adds: reminders on each version, uploaded leads, and reminder bubbles in test chats.
-- Safe to run more than once. Run after migration 002, in the K1 Supabase SQL editor.

-- 1. Reminders are versioned with the prompt and opener ------------------------
-- Shape: [{ "text": "...", "days": 3 }, { "text": "...", "days": 4 }, { "text": "...", "days": 7 }]
-- Reminder 1 is days after the opener, reminder 2 days after reminder 1,
-- reminder 3 days after the inspection expires (only if not booked).

alter table public.agent_builder_versions
  add column if not exists reminders jsonb not null default '[]'::jsonb;

drop function if exists public.save_agent_builder_version(text, text, text, text, boolean, text, text);

create or replace function public.save_agent_builder_version(
  p_tenant_key text,
  p_master_prompt text,
  p_opening_message text,
  p_additional_information text default '',
  p_locked boolean default false,
  p_note text default '',
  p_saved_by text default null,
  p_reminders jsonb default '[]'::jsonb
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
    opening_message, note, saved_by, reminders
  )
  values (
    target_agent.id, next_version, false, p_master_prompt, p_additional_information,
    p_opening_message, coalesce(p_note, ''), p_saved_by,
    case when jsonb_typeof(p_reminders) = 'array' then p_reminders else '[]'::jsonb end
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

-- 2. Uploaded leads (shown alongside the sample leads) ---------------------------

create table if not exists public.agent_builder_leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  name text not null,
  email text not null default '',
  phone text not null default '',
  registration text not null,
  registration_key text generated always as (upper(regexp_replace(registration, '[\s-]', '', 'g'))) stored,
  inspection_due date null,
  source text not null default 'csv',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_builder_leads_registration_uidx
  on public.agent_builder_leads (agent_id, registration_key);

alter table public.agent_builder_leads enable row level security;

-- Re-uploading the same registration updates that lead instead of duplicating it.
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
    select distinct on (upper(regexp_replace(trim(r.registration), '[\s-]', '', 'g')))
      trim(r.name) as name,
      coalesce(trim(r.email), '') as email,
      coalesce(trim(r.phone), '') as phone,
      trim(r.registration) as registration,
      case when coalesce(trim(r.inspection_due), '') ~ '^\d{4}-\d{2}-\d{2}$' then trim(r.inspection_due)::date end as inspection_due
    from jsonb_to_recordset(p_rows) as r(name text, email text, phone text, registration text, inspection_due text)
    where coalesce(trim(r.name), '') <> '' and coalesce(trim(r.registration), '') <> ''
    order by upper(regexp_replace(trim(r.registration), '[\s-]', '', 'g'))
  ),
  written as (
    insert into public.agent_builder_leads as l (agent_id, name, email, phone, registration, inspection_due, source)
    select target_agent_id, i.name, i.email, i.phone, i.registration, i.inspection_due, 'csv' from incoming i
    on conflict (agent_id, registration_key) do update
      set name = excluded.name, email = excluded.email, phone = excluded.phone,
          registration = excluded.registration, inspection_due = excluded.inspection_due, updated_at = now()
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
    'name', l.name,
    'email', l.email,
    'phone', l.phone,
    'registration', l.registration,
    'inspectionDue', l.inspection_due,
    'source', l.source,
    'createdAt', l.created_at
  ) order by l.created_at desc, l.name), '[]'::json)
  from public.agent_builder_leads l
  join public.agent_builder_agents a on a.id = l.agent_id
  where a.tenant_key = p_tenant_key;
$$;

-- 3. Reminder bubbles in test chats ---------------------------------------------

alter table public.agent_builder_test_messages
  add column if not exists kind text null;

-- Adds a reminder (an agent message with no customer turn) to a test chat,
-- creating the conversation first if needed.
create or replace function public.record_test_message(
  p_tenant_key text,
  p_conversation_id uuid,
  p_version_id uuid,
  p_is_draft boolean,
  p_source text,
  p_opener text,
  p_text text,
  p_kind text,
  p_started_by text default null
)
returns table (conversation_id uuid, message_id uuid)
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  conv_id uuid := p_conversation_id;
  version_no integer;
  msg_id uuid;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;

  if conv_id is null or not exists (select 1 from public.agent_builder_test_conversations c where c.id = conv_id) then
    select v.version_number into version_no from public.agent_builder_versions v where v.id = p_version_id;
    insert into public.agent_builder_test_conversations (
      id, agent_id, version_id, version_number, is_draft, source, title, started_by
    )
    values (
      coalesce(conv_id, gen_random_uuid()), target_agent_id, p_version_id, version_no,
      coalesce(p_is_draft, false), coalesce(p_source, 'playground'),
      left(coalesce(p_text, ''), 140), p_started_by
    )
    returning id into conv_id;

    if coalesce(p_opener, '') <> '' then
      insert into public.agent_builder_test_messages (conversation_id, role, text, is_opener)
      values (conv_id, 'agent', p_opener, true);
    end if;
  end if;

  insert into public.agent_builder_test_messages (conversation_id, role, text, kind)
  values (conv_id, 'agent', p_text, left(coalesce(p_kind, 'reminder'), 40))
  returning id into msg_id;

  update public.agent_builder_test_conversations set updated_at = now() where id = conv_id;

  return query select conv_id, msg_id;
end;
$$;

create or replace function public.get_test_conversation(p_id uuid)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'conversation', to_json(l),
    'messages', coalesce((
      select json_agg(json_build_object(
        'id', m.id, 'role', m.role, 'text', m.text, 'isOpener', m.is_opener,
        'kind', m.kind, 'feedback', m.feedback, 'createdAt', m.created_at
      ) order by m.created_at)
      from public.agent_builder_test_messages m where m.conversation_id = l.id
    ), '[]'::json)
  )
  from public.agent_builder_test_conversation_list l
  where l.id = p_id;
$$;

-- 4. State includes each version's reminders -------------------------------------

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
