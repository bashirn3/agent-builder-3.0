-- K1 Agent Builder 005: faster state and test chat queries, and resetting saved versions.
-- Safe to run more than once. Run after 004.

create extension if not exists pg_trgm;

create index if not exists agent_builder_test_messages_text_trgm
  on public.agent_builder_test_messages using gin (text gin_trgm_ops);

-- 1. State: optionally leave out prompt text for versions that are not active ---------
-- Every saved version carries a full prompt; sending all of them on each page load is
-- most of the response size. Callers that need one version's text ask for it by id.

drop function if exists public.get_agent_builder_state(text);

create or replace function public.get_agent_builder_state(p_tenant_key text, p_include_prompts boolean default true)
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
        'hasContent', p_include_prompts or v.is_active,
        'masterPrompt', case when p_include_prompts or v.is_active then v.master_prompt end,
        'additionalInformation', case when p_include_prompts or v.is_active then v.additional_information end,
        'openingMessage', case when p_include_prompts or v.is_active then v.opening_message end,
        'reminders', case when p_include_prompts or v.is_active then v.reminders end,
        'translations', case when p_include_prompts or v.is_active then v.translations end,
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
        where c.agent_id = a.id and not c.is_draft
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

-- One version's full content, for opening a version that the light state left out.
create or replace function public.get_agent_builder_version(p_tenant_key text, p_version_id uuid)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'id', v.id,
    'versionNumber', v.version_number,
    'masterPrompt', v.master_prompt,
    'additionalInformation', v.additional_information,
    'openingMessage', v.opening_message,
    'reminders', v.reminders,
    'translations', v.translations
  )
  from public.agent_builder_versions v
  join public.agent_builder_agents a on a.id = v.agent_id
  where a.tenant_key = p_tenant_key and v.id = p_version_id;
$$;

-- 2. Test chat list: filter and page first, then count only the returned chats ------
-- The previous version aggregated every conversation (of every tenant) before
-- filtering. This walks the tenant's chats newest first and stops at the page size;
-- search uses the trigram index and treats % and _ in the query as literal text.

create index if not exists agent_builder_test_conversations_agent_idx
  on public.agent_builder_test_conversations (agent_id, updated_at desc);

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
  with pattern as (
    select case
      when coalesce(btrim(p_query), '') = '' then null
      else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as value
  ),
  page as (
    select c.*
    from public.agent_builder_test_conversations c, pattern
    where c.agent_id = (select a.id from public.agent_builder_agents a where a.tenant_key = p_tenant_key)
      and (
        p_versions is null
        or (c.version_number = any(p_versions) and not c.is_draft)
        or (p_include_draft and c.is_draft)
      )
      and (p_versions is not null or p_include_draft or not c.is_draft)
      and (p_source is null or c.source = p_source)
      and (p_from is null or c.updated_at >= p_from)
      and (p_to is null or c.updated_at < p_to)
      and (p_feedback is null
        or (p_feedback = 'up' and exists (select 1 from public.agent_builder_test_messages m where m.conversation_id = c.id and m.feedback = 'up'))
        or (p_feedback = 'down' and exists (select 1 from public.agent_builder_test_messages m where m.conversation_id = c.id and m.feedback = 'down'))
        or (p_feedback = 'none' and not exists (select 1 from public.agent_builder_test_messages m where m.conversation_id = c.id and m.feedback in ('up', 'down'))))
      and (pattern.value is null or c.id in (
        select m.conversation_id from public.agent_builder_test_messages m where m.text ilike pattern.value
      ))
    order by c.updated_at desc
    limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)
  )
  select
    c.id,
    p_tenant_key as tenant_key,
    c.version_id,
    c.version_number,
    c.is_draft,
    c.source,
    c.title,
    c.started_by,
    c.created_at,
    c.updated_at,
    s.message_count,
    s.thumbs_up,
    s.thumbs_down,
    r.text as last_reply
  from page c
  cross join lateral (
    select
      count(*) filter (where not m.is_opener) as message_count,
      count(*) filter (where m.feedback = 'up') as thumbs_up,
      count(*) filter (where m.feedback = 'down') as thumbs_down
    from public.agent_builder_test_messages m
    where m.conversation_id = c.id
  ) s
  left join lateral (
    select m.text
    from public.agent_builder_test_messages m
    where m.conversation_id = c.id and m.role = 'agent' and not m.is_opener
    order by m.created_at desc
    limit 1
  ) r on true
  order by c.updated_at desc;
$$;

-- 3. Reset saved versions ---------------------------------------------------------------
-- Keeps the latest saved version as v1 and removes every older version, all test chats
-- and all deploy requests. Nothing is marked live afterwards.

create or replace function public.reset_agent_builder_versions(p_tenant_key text)
returns json
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  kept_id uuid;
  kept_number integer;
  removed_versions integer;
  removed_chats integer;
  removed_requests integer;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key for update;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;

  select v.id, v.version_number into kept_id, kept_number
  from public.agent_builder_versions v
  where v.agent_id = target_agent_id
  order by v.version_number desc
  limit 1;
  if kept_id is null then raise exception 'no_versions'; end if;

  delete from public.agent_builder_deploy_requests r where r.agent_id = target_agent_id;
  get diagnostics removed_requests = row_count;

  delete from public.agent_builder_test_conversations c where c.agent_id = target_agent_id;
  get diagnostics removed_chats = row_count;

  update public.agent_builder_agents
  set active_version_id = kept_id, live_version_id = null, live_since = null, live_by = null, updated_at = now()
  where id = target_agent_id;

  delete from public.agent_builder_versions v where v.agent_id = target_agent_id and v.id <> kept_id;
  get diagnostics removed_versions = row_count;

  update public.agent_builder_versions
  set version_number = 1, is_active = true
  where id = kept_id;

  return json_build_object(
    'keptVersionId', kept_id,
    'keptFromNumber', kept_number,
    'removedVersions', removed_versions,
    'removedChats', removed_chats,
    'removedRequests', removed_requests
  );
end;
$$;

-- Only the backend (service role) may reset; the public API key must not reach this.
revoke all on function public.reset_agent_builder_versions(text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.reset_agent_builder_versions(text) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function public.reset_agent_builder_versions(text) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.reset_agent_builder_versions(text) to service_role; end if;
end $$;
