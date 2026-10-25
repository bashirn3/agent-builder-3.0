-- K1 Agent Builder 007: one WhatsApp number can hold one saved bot version.
-- Safe to run more than once. Run after 006.
-- Only phones sent from the Staging page get a row. Every other customer stays on the live agent.
-- The opener is stored on the test conversation. Later WhatsApp turns append to that conversation.
-- Reset keeps the version and starts a new empty conversation, so chat memory does not carry over.
--
-- The builder project has no postgres credential the live listener can use, so this
-- file is not what the WhatsApp workflow calls today. Assignments and staging
-- transcripts are stored as k1_staging_sessions, k1_staging_conversations and
-- k1_staging_messages on the agent database. Applying this file later does not
-- switch that listener over.

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'agent_builder_test_conversations'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%source%';
  if constraint_name is not null then
    execute format('alter table public.agent_builder_test_conversations drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.agent_builder_test_conversations
  drop constraint if exists agent_builder_test_conversations_source_check;

alter table public.agent_builder_test_conversations
  add constraint agent_builder_test_conversations_source_check
  check (source in ('playground', 'compare', 'staging'));

create table if not exists public.agent_builder_staging_sessions (
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  phone_key text not null,
  phone text not null,
  version_id uuid references public.agent_builder_versions(id) on delete set null,
  version_number integer,
  conversation_id uuid not null,
  lead jsonb not null default '{}'::jsonb,
  lead_context text not null default '',
  opener text not null default '',
  updated_at timestamptz not null default now(),
  primary key (agent_id, phone_key)
);

create index if not exists agent_builder_staging_sessions_updated_idx
  on public.agent_builder_staging_sessions (agent_id, updated_at desc);

alter table public.agent_builder_staging_sessions enable row level security;

create or replace function public.claim_staging_session(
  p_tenant_key text,
  p_phone text,
  p_version_id uuid,
  p_opener text,
  p_lead jsonb default '{}'::jsonb,
  p_lead_context text default '',
  p_started_by text default null
)
returns json
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  normalized_phone text;
  version_no integer;
  conv_id uuid := gen_random_uuid();
  plate text := coalesce(p_lead->>'plateNumber', '');
  title text;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;
  normalized_phone := public.agent_builder_phone_key(p_phone);
  if normalized_phone is null then raise exception 'phone_required'; end if;
  select v.version_number into version_no
  from public.agent_builder_versions v
  where v.id = p_version_id and v.agent_id = target_agent_id;
  if version_no is null then raise exception 'unknown_version'; end if;

  title := left(trim(both ' ·' from trim(coalesce(p_phone, '')) || ' · ' || trim(plate)), 140);
  insert into public.agent_builder_test_conversations (
    id, agent_id, version_id, version_number, is_draft, source, title, started_by
  ) values (
    conv_id, target_agent_id, p_version_id, version_no, false, 'staging', title, p_started_by
  );

  if coalesce(p_opener, '') <> '' then
    insert into public.agent_builder_test_messages (conversation_id, role, text, is_opener)
    values (conv_id, 'agent', p_opener, true);
  end if;

  insert into public.agent_builder_staging_sessions as s (
    agent_id, phone_key, phone, version_id, version_number, conversation_id, lead, lead_context, opener
  ) values (
    target_agent_id, normalized_phone, trim(p_phone), p_version_id, version_no, conv_id,
    coalesce(p_lead, '{}'::jsonb), coalesce(p_lead_context, ''), coalesce(p_opener, '')
  )
  on conflict (agent_id, phone_key) do update set
    phone = excluded.phone,
    version_id = excluded.version_id,
    version_number = excluded.version_number,
    conversation_id = excluded.conversation_id,
    lead = excluded.lead,
    lead_context = excluded.lead_context,
    opener = excluded.opener,
    updated_at = now();

  return json_build_object(
    'ok', true,
    'phoneKey', normalized_phone,
    'phone', trim(p_phone),
    'conversationId', conv_id,
    'versionId', p_version_id,
    'versionNumber', version_no
  );
end;
$$;

create or replace function public.list_staging_sessions(p_tenant_key text)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'ok', true,
    'sessions', coalesce((
      select json_agg(json_build_object(
        'phone', s.phone,
        'phoneKey', s.phone_key,
        'plate', coalesce(s.lead->>'plateNumber', ''),
        'stationName', coalesce(s.lead->>'stationName', ''),
        'versionId', s.version_id,
        'versionNumber', s.version_number,
        'conversationId', s.conversation_id,
        'updatedAt', s.updated_at
      ) order by s.updated_at desc)
      from public.agent_builder_staging_sessions s
      join public.agent_builder_agents a on a.id = s.agent_id
      where a.tenant_key = p_tenant_key
    ), '[]'::json)
  );
$$;

-- Loaded on every inbound turn for an assigned phone. The prompt is the saved version, not the live CONFIG prompt.
create or replace function public.get_staging_session(p_tenant_key text, p_phone text)
returns json
language sql
stable
security invoker
as $$
  select coalesce((
    select json_build_object(
      'found', true,
      'phone', s.phone,
      'phoneKey', s.phone_key,
      'versionId', s.version_id,
      'versionNumber', s.version_number,
      'conversationId', s.conversation_id,
      'leadContext', s.lead_context,
      'prompt', concat_ws(E'\n\n',
        nullif(btrim(v.master_prompt), ''),
        nullif(btrim(v.additional_information), ''),
        nullif(btrim(s.lead_context), '')
      )
    )
    from public.agent_builder_staging_sessions s
    join public.agent_builder_agents a on a.id = s.agent_id
    join public.agent_builder_versions v on v.id = s.version_id and v.agent_id = s.agent_id
    where a.tenant_key = p_tenant_key
      and s.phone_key = public.agent_builder_phone_key(p_phone)
  ), json_build_object('found', false));
$$;

-- Keeps the version and the lead. The new conversation id is what the chat-memory key includes, so the next message starts empty.
create or replace function public.reset_staging_session(p_tenant_key text, p_phone text)
returns json
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  normalized_phone text;
  session public.agent_builder_staging_sessions%rowtype;
  conv_id uuid := gen_random_uuid();
  plate text;
  title text;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;
  normalized_phone := public.agent_builder_phone_key(p_phone);
  if normalized_phone is null then raise exception 'phone_required'; end if;

  select * into session
  from public.agent_builder_staging_sessions s
  where s.agent_id = target_agent_id and s.phone_key = normalized_phone
  for update;

  if not found then
    return json_build_object('ok', true, 'found', false);
  end if;

  plate := coalesce(session.lead->>'plateNumber', '');
  title := left(trim(both ' ·' from trim(session.phone) || ' · ' || trim(plate)), 140);
  insert into public.agent_builder_test_conversations (
    id, agent_id, version_id, version_number, is_draft, source, title, started_by
  ) values (
    conv_id, target_agent_id, session.version_id, session.version_number, false, 'staging', title, null
  );

  update public.agent_builder_staging_sessions
  set conversation_id = conv_id, updated_at = now()
  where agent_id = target_agent_id and phone_key = normalized_phone;

  return json_build_object(
    'ok', true,
    'found', true,
    'conversationId', conv_id,
    'versionId', session.version_id,
    'versionNumber', session.version_number
  );
end;
$$;

create or replace function public.append_test_message(
  p_conversation_id uuid,
  p_role text,
  p_text text,
  p_is_opener boolean default false
)
returns json
language plpgsql
security invoker
as $$
declare
  message_id uuid;
begin
  if p_conversation_id is null or not exists (
    select 1 from public.agent_builder_test_conversations c where c.id = p_conversation_id
  ) then
    return json_build_object('ok', false);
  end if;
  if coalesce(p_text, '') = '' then
    return json_build_object('ok', false);
  end if;
  if p_role not in ('user', 'agent') then
    return json_build_object('ok', false);
  end if;
  insert into public.agent_builder_test_messages (conversation_id, role, text, is_opener)
  values (p_conversation_id, p_role, p_text, coalesce(p_is_opener, false))
  returning id into message_id;
  update public.agent_builder_test_conversations set updated_at = now() where id = p_conversation_id;
  return json_build_object('ok', true, 'id', message_id);
end;
$$;

revoke all on function public.claim_staging_session(text, text, uuid, text, jsonb, text, text) from public;
revoke all on function public.list_staging_sessions(text) from public;
revoke all on function public.get_staging_session(text, text) from public;
revoke all on function public.reset_staging_session(text, text) from public;
revoke all on function public.append_test_message(uuid, text, text, boolean) from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.claim_staging_session(text, text, uuid, text, jsonb, text, text) from anon;
    revoke all on function public.list_staging_sessions(text) from anon;
    revoke all on function public.get_staging_session(text, text) from anon;
    revoke all on function public.reset_staging_session(text, text) from anon;
    revoke all on function public.append_test_message(uuid, text, text, boolean) from anon;
    revoke all on table public.agent_builder_staging_sessions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.claim_staging_session(text, text, uuid, text, jsonb, text, text) from authenticated;
    revoke all on function public.list_staging_sessions(text) from authenticated;
    revoke all on function public.get_staging_session(text, text) from authenticated;
    revoke all on function public.reset_staging_session(text, text) from authenticated;
    revoke all on function public.append_test_message(uuid, text, text, boolean) from authenticated;
    revoke all on table public.agent_builder_staging_sessions from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_staging_session(text, text, uuid, text, jsonb, text, text) to service_role;
    grant execute on function public.list_staging_sessions(text) to service_role;
    grant execute on function public.get_staging_session(text, text) to service_role;
    grant execute on function public.reset_staging_session(text, text) to service_role;
    grant execute on function public.append_test_message(uuid, text, text, boolean) to service_role;
    grant select, insert, update, delete on table public.agent_builder_staging_sessions to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

select 'ok' as status;
