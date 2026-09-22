-- K1 Agent Builder schema
-- Stores the editable prompt configuration for the single K1 Katsastus agent.
-- Intended for a separate K1 Supabase project, not the Wasup-Dental database.

create extension if not exists pgcrypto;

create table if not exists public.agent_builder_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_key text not null unique,
  display_name text not null,
  locked boolean not null default false,
  active_version_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_builder_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  version_number integer not null,
  is_active boolean not null default false,
  master_prompt text not null,
  additional_information text not null default '',
  opening_message text not null default '',
  created_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(agent_id, version_number)
);

alter table public.agent_builder_agents
  add constraint agent_builder_agents_active_version_fk
  foreign key (active_version_id)
  references public.agent_builder_versions(id)
  deferrable initially deferred;

create unique index if not exists agent_builder_versions_active_uidx
  on public.agent_builder_versions(agent_id)
  where is_active;

create or replace function public.touch_agent_builder_agent()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_agent_builder_agent on public.agent_builder_agents;
create trigger touch_agent_builder_agent
before update on public.agent_builder_agents
for each row execute function public.touch_agent_builder_agent();

create or replace view public.agent_builder_active_config as
select
  a.id as agent_id,
  a.tenant_key,
  a.display_name,
  a.locked,
  v.id as version_id,
  v.version_number,
  v.master_prompt,
  v.additional_information,
  v.opening_message,
  v.created_at as version_created_at
from public.agent_builder_agents a
left join public.agent_builder_versions v on v.id = a.active_version_id;

create or replace function public.save_agent_builder_version(
  p_tenant_key text,
  p_master_prompt text,
  p_opening_message text,
  p_additional_information text default '',
  p_locked boolean default false
)
returns table (
  version_id uuid,
  version_number integer,
  active_version_id uuid,
  locked boolean
)
language plpgsql
security invoker
as $$
declare
  target_agent public.agent_builder_agents%rowtype;
  next_version integer;
  inserted_version_id uuid;
begin
  select * into target_agent
  from public.agent_builder_agents
  where tenant_key = p_tenant_key
  for update;

  if not found then
    insert into public.agent_builder_agents (tenant_key, display_name, locked)
    values (p_tenant_key, 'K1 Katsastus', false)
    returning * into target_agent;
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.agent_builder_versions
  where agent_id = target_agent.id;

  insert into public.agent_builder_versions (
    agent_id,
    version_number,
    is_active,
    master_prompt,
    additional_information,
    opening_message,
    created_by
  )
  values (
    target_agent.id,
    next_version,
    true,
    p_master_prompt,
    p_additional_information,
    p_opening_message,
    auth.uid()
  )
  returning id into inserted_version_id;

  update public.agent_builder_versions
  set is_active = false
  where agent_id = target_agent.id
    and id <> inserted_version_id;

  update public.agent_builder_agents
  set active_version_id = inserted_version_id,
      locked = p_locked
  where id = target_agent.id;

  return query
  select inserted_version_id, next_version, inserted_version_id, p_locked;
end;
$$;

alter table public.agent_builder_agents enable row level security;
alter table public.agent_builder_versions enable row level security;

-- Direct browser access is safe only after authenticated users receive a
-- `tenant_key` claim in app_metadata. Until then, use the n8n proxy path.
create policy "agent builder agents read by tenant"
on public.agent_builder_agents
for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'tenant_key') = tenant_key);

create policy "agent builder agents update by tenant"
on public.agent_builder_agents
for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'tenant_key') = tenant_key)
with check ((auth.jwt() -> 'app_metadata' ->> 'tenant_key') = tenant_key);

create policy "agent builder versions read by tenant"
on public.agent_builder_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.agent_builder_agents a
    where a.id = agent_builder_versions.agent_id
      and (auth.jwt() -> 'app_metadata' ->> 'tenant_key') = a.tenant_key
  )
);

create policy "agent builder versions insert by tenant"
on public.agent_builder_versions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.agent_builder_agents a
    where a.id = agent_builder_versions.agent_id
      and (auth.jwt() -> 'app_metadata' ->> 'tenant_key') = a.tenant_key
  )
);

insert into public.agent_builder_agents (tenant_key, display_name, locked)
values ('k1_katsastus_demo', 'K1 Katsastus', false)
on conflict (tenant_key) do update
set display_name = excluded.display_name;
