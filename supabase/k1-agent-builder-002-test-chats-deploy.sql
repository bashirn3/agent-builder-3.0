-- K1 Agent Builder — migration 002
-- Adds: a live-version marker separate from the latest save, version notes,
-- saved test conversations with per-reply thumbs, and deploy requests.
-- Safe to run more than once. Run in the K1 Supabase project's SQL editor.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- 1. Versions: who saved, what changed, and which one is live -------------------

alter table public.agent_builder_versions
  add column if not exists note text not null default '',
  add column if not exists saved_by text null;

alter table public.agent_builder_agents
  add column if not exists live_version_id uuid null,
  add column if not exists live_since timestamptz null,
  add column if not exists live_by text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_builder_agents_live_version_fk') then
    alter table public.agent_builder_agents
      add constraint agent_builder_agents_live_version_fk
      foreign key (live_version_id) references public.agent_builder_versions(id)
      on delete set null deferrable initially deferred;
  end if;
end $$;

-- Saving no longer implies "live". `is_active` keeps meaning "latest saved"
-- (what the builder opens by default); `live_version_id` is set only by a deploy.
drop function if exists public.save_agent_builder_version(text, text, text, text, boolean);

create or replace function public.save_agent_builder_version(
  p_tenant_key text,
  p_master_prompt text,
  p_opening_message text,
  p_additional_information text default '',
  p_locked boolean default false,
  p_note text default '',
  p_saved_by text default null
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
    opening_message, note, saved_by
  )
  values (
    target_agent.id, next_version, false, p_master_prompt, p_additional_information,
    p_opening_message, coalesce(p_note, ''), p_saved_by
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

-- 2. Test conversations and messages --------------------------------------------

create table if not exists public.agent_builder_test_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  version_id uuid null references public.agent_builder_versions(id) on delete set null,
  version_number integer null,
  is_draft boolean not null default false,
  source text not null default 'playground' check (source in ('playground', 'compare')),
  title text not null default '',
  started_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_builder_test_conversations_agent_idx
  on public.agent_builder_test_conversations (agent_id, updated_at desc);

create table if not exists public.agent_builder_test_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_builder_test_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'agent')),
  text text not null,
  is_opener boolean not null default false,
  feedback text null check (feedback in ('up', 'down')),
  feedback_at timestamptz null,
  feedback_by text null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists agent_builder_test_messages_conversation_idx
  on public.agent_builder_test_messages (conversation_id, created_at);
create index if not exists agent_builder_test_messages_text_trgm
  on public.agent_builder_test_messages using gin (text gin_trgm_ops);

-- Records one test turn (the customer's message and the agent's reply).
-- Creates the conversation on the first turn, including the opener bubble.
create or replace function public.record_test_turn(
  p_tenant_key text,
  p_conversation_id uuid,
  p_version_id uuid,
  p_is_draft boolean,
  p_source text,
  p_opener text,
  p_user_text text,
  p_agent_text text,
  p_started_by text default null
)
returns table (conversation_id uuid, user_message_id uuid, agent_message_id uuid)
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  conv_id uuid := p_conversation_id;
  version_no integer;
  user_id uuid;
  agent_id_msg uuid;
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
      left(coalesce(p_user_text, ''), 140), p_started_by
    )
    returning id into conv_id;

    if coalesce(p_opener, '') <> '' then
      insert into public.agent_builder_test_messages (conversation_id, role, text, is_opener)
      values (conv_id, 'agent', p_opener, true);
    end if;
  end if;

  insert into public.agent_builder_test_messages (conversation_id, role, text)
  values (conv_id, 'user', p_user_text) returning id into user_id;
  insert into public.agent_builder_test_messages (conversation_id, role, text)
  values (conv_id, 'agent', p_agent_text) returning id into agent_id_msg;

  update public.agent_builder_test_conversations set updated_at = now() where id = conv_id;

  return query select conv_id, user_id, agent_id_msg;
end;
$$;

create or replace function public.set_test_feedback(
  p_message_id uuid,
  p_feedback text,
  p_by text default null
)
returns table (message_id uuid, feedback text)
language sql
security invoker
as $$
  update public.agent_builder_test_messages m
  set feedback = case when p_feedback in ('up', 'down') then p_feedback else null end,
      feedback_at = case when p_feedback in ('up', 'down') then now() else null end,
      feedback_by = case when p_feedback in ('up', 'down') then p_by else null end
  where m.id = p_message_id and m.role = 'agent'
  returning m.id, m.feedback;
$$;

-- One row per conversation with counts, for the Test chats list.
create or replace view public.agent_builder_test_conversation_list as
select
  c.id,
  a.tenant_key,
  c.version_id,
  c.version_number,
  c.is_draft,
  c.source,
  c.title,
  c.started_by,
  c.created_at,
  c.updated_at,
  count(m.id) filter (where not m.is_opener) as message_count,
  count(m.id) filter (where m.feedback = 'up') as thumbs_up,
  count(m.id) filter (where m.feedback = 'down') as thumbs_down,
  (array_agg(m.text order by m.created_at desc) filter (where m.role = 'agent' and not m.is_opener))[1] as last_reply
from public.agent_builder_test_conversations c
join public.agent_builder_agents a on a.id = c.agent_id
left join public.agent_builder_test_messages m on m.conversation_id = c.id
group by c.id, a.tenant_key;

create or replace function public.list_test_conversations(
  p_tenant_key text,
  p_versions integer[] default null,
  p_include_draft boolean default true,
  p_feedback text default null,
  p_source text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof public.agent_builder_test_conversation_list
language sql
stable
security invoker
as $$
  select l.*
  from public.agent_builder_test_conversation_list l
  where l.tenant_key = p_tenant_key
    and (
      p_versions is null
      or (l.version_number = any(p_versions) and not l.is_draft)
      or (p_include_draft and l.is_draft)
    )
    and (p_versions is not null or p_include_draft or not l.is_draft)
    and (p_feedback is null
      or (p_feedback = 'up' and l.thumbs_up > 0)
      or (p_feedback = 'down' and l.thumbs_down > 0)
      or (p_feedback = 'none' and l.thumbs_up = 0 and l.thumbs_down = 0))
    and (p_source is null or l.source = p_source)
    and (p_from is null or l.updated_at >= p_from)
    and (p_to is null or l.updated_at < p_to)
    and (coalesce(p_query, '') = '' or exists (
      select 1 from public.agent_builder_test_messages m
      where m.conversation_id = l.id and m.text ilike '%' || p_query || '%'
    ))
  order by l.updated_at desc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
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
        'feedback', m.feedback, 'createdAt', m.created_at
      ) order by m.created_at)
      from public.agent_builder_test_messages m where m.conversation_id = l.id
    ), '[]'::json)
  )
  from public.agent_builder_test_conversation_list l
  where l.id = p_id;
$$;

-- 3. Deploy requests -------------------------------------------------------------

create table if not exists public.agent_builder_deploy_requests (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  version_id uuid not null references public.agent_builder_versions(id) on delete cascade,
  version_number integer not null,
  requested_by text not null,
  requester_email text not null default '',
  go_live text not null default '',
  notes text not null default '',
  status text not null default 'requested' check (status in ('requested', 'deployed', 'superseded')),
  confirm_token text not null default encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default now(),
  deployed_at timestamptz null,
  deployed_by text null
);

create index if not exists agent_builder_deploy_requests_agent_idx
  on public.agent_builder_deploy_requests (agent_id, created_at desc);

create or replace function public.request_deploy(
  p_tenant_key text,
  p_version_id uuid,
  p_requested_by text,
  p_requester_email text default '',
  p_go_live text default '',
  p_notes text default ''
)
returns setof public.agent_builder_deploy_requests
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  version_no integer;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  select v.version_number into version_no from public.agent_builder_versions v
  where v.id = p_version_id and v.agent_id = target_agent_id;
  if version_no is null then raise exception 'unknown_version'; end if;

  return query
  insert into public.agent_builder_deploy_requests (
    agent_id, version_id, version_number, requested_by, requester_email, go_live, notes
  )
  values (
    target_agent_id, p_version_id, version_no, p_requested_by,
    coalesce(p_requester_email, ''), coalesce(p_go_live, ''), coalesce(p_notes, '')
  )
  returning *;
end;
$$;

-- Called from the link in Rapid's email once the version is live on WhatsApp.
create or replace function public.confirm_deploy(p_token text, p_by text default 'Rapid')
returns table (version_number integer, deployed_at timestamptz, already_deployed boolean)
language plpgsql
security invoker
as $$
declare
  req public.agent_builder_deploy_requests%rowtype;
begin
  select * into req from public.agent_builder_deploy_requests r where r.confirm_token = p_token;
  if not found then raise exception 'unknown_token'; end if;

  if req.status = 'deployed' then
    return query select req.version_number, req.deployed_at, true;
    return;
  end if;

  update public.agent_builder_deploy_requests r
  set status = 'deployed', deployed_at = now(), deployed_by = p_by
  where r.id = req.id;

  update public.agent_builder_deploy_requests r
  set status = 'superseded'
  where r.agent_id = req.agent_id and r.status = 'requested' and r.id <> req.id
    and r.version_number < req.version_number;

  update public.agent_builder_agents a
  set live_version_id = req.version_id, live_since = now(), live_by = p_by
  where a.id = req.agent_id;

  return query select req.version_number, now(), false;
end;
$$;

-- 4. Everything the builder needs in one call ------------------------------------

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

-- 5. Row level security ------------------------------------------------------------
-- The builder talks to these through n8n with the service key. Browser access
-- stays closed until Clerk sign-in adds a tenant claim.

alter table public.agent_builder_test_conversations enable row level security;
alter table public.agent_builder_test_messages enable row level security;
alter table public.agent_builder_deploy_requests enable row level security;
