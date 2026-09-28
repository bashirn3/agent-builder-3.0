-- K1 Agent Builder 006: Muster staging bookings and one history per phone number.
-- Safe to run more than once. Run after 005.
-- Staging only. Chain 91. Vehicle category is always M1; the vehicle lookup is not used.
-- Muster cannot list reservations, so every booking the agent makes is recorded here
-- and checked back against Muster by group id.

create table if not exists public.agent_builder_bookings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  phone_key text not null,
  phone text not null,
  plate text not null,
  station_id integer not null,
  station_name text not null default '',
  chain_id integer not null default 91,
  environment text not null default 'staging',
  vehicle_category text not null default 'M1',
  product_ids jsonb not null default '[]'::jsonb,
  group_id text not null,
  reservation_uid text not null,
  booking_number text,
  customer_uid text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'confirmed',
  language text not null default 'Finnish',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_builder_bookings_status check (status in ('pending', 'confirmed', 'cancelled')),
  constraint agent_builder_bookings_environment check (environment = 'staging')
);

create unique index if not exists agent_builder_bookings_reservation_uidx
  on public.agent_builder_bookings(agent_id, reservation_uid);

create index if not exists agent_builder_bookings_phone_idx
  on public.agent_builder_bookings(agent_id, phone_key, starts_at desc);

create index if not exists agent_builder_bookings_when_idx
  on public.agent_builder_bookings(agent_id, starts_at)
  where status = 'confirmed';

-- Facts the agent should remember for this phone, separate from the chat transcript.
create table if not exists public.agent_builder_customer_context (
  agent_id uuid not null references public.agent_builder_agents(id) on delete cascade,
  phone_key text not null,
  phone text not null,
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (agent_id, phone_key)
);

create or replace function public.agent_builder_phone_key(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
$$;

create or replace function public.record_booking(
  p_tenant_key text,
  p_phone text,
  p_plate text,
  p_station_id integer,
  p_station_name text,
  p_product_ids jsonb,
  p_group_id text,
  p_reservation_uid text,
  p_booking_number text,
  p_customer_uid text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_status text,
  p_language text default 'Finnish'
)
returns json
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  row_id uuid;
  normalized_phone text;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;
  normalized_phone := public.agent_builder_phone_key(p_phone);
  if normalized_phone is null then raise exception 'phone_required'; end if;
  if coalesce(p_group_id, '') = '' or coalesce(p_reservation_uid, '') = '' then raise exception 'booking_ids_required'; end if;
  if p_status not in ('pending', 'confirmed', 'cancelled') then raise exception 'bad_status'; end if;

  insert into public.agent_builder_bookings as b (
    agent_id, phone_key, phone, plate, station_id, station_name, product_ids,
    group_id, reservation_uid, booking_number, customer_uid, starts_at, ends_at, status, language
  ) values (
    target_agent_id, normalized_phone, trim(p_phone), upper(trim(p_plate)), p_station_id, coalesce(p_station_name, ''),
    coalesce(p_product_ids, '[]'::jsonb), p_group_id, p_reservation_uid, nullif(p_booking_number, ''),
    nullif(p_customer_uid, ''), p_starts_at, p_ends_at, p_status, coalesce(nullif(p_language, ''), 'Finnish')
  )
  on conflict (agent_id, reservation_uid) do update set
    phone_key = excluded.phone_key,
    phone = excluded.phone,
    plate = excluded.plate,
    station_id = excluded.station_id,
    station_name = excluded.station_name,
    product_ids = excluded.product_ids,
    group_id = excluded.group_id,
    booking_number = coalesce(excluded.booking_number, b.booking_number),
    customer_uid = coalesce(excluded.customer_uid, b.customer_uid),
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    status = excluded.status,
    language = excluded.language,
    updated_at = now()
  returning id into row_id;

  -- A reschedule keeps the group and replaces the reservation, so the old row is no longer live.
  if p_status = 'confirmed' then
    update public.agent_builder_bookings
    set status = 'cancelled', updated_at = now()
    where agent_id = target_agent_id and group_id = p_group_id and reservation_uid <> p_reservation_uid and status <> 'cancelled';
  end if;

  return json_build_object('id', row_id, 'phoneKey', normalized_phone, 'status', p_status);
end;
$$;

create or replace function public.list_bookings(
  p_tenant_key text,
  p_from timestamptz,
  p_to timestamptz,
  p_station_id integer default null
)
returns json
language sql
stable
security invoker
as $$
  select coalesce(json_agg(json_build_object(
    'id', b.id,
    'phone', b.phone,
    'plate', b.plate,
    'stationId', b.station_id,
    'stationName', b.station_name,
    'productIds', b.product_ids,
    'groupId', b.group_id,
    'reservationUid', b.reservation_uid,
    'bookingNumber', b.booking_number,
    'customerUid', b.customer_uid,
    'startsAt', b.starts_at,
    'endsAt', b.ends_at,
    'status', b.status,
    'language', b.language
  ) order by b.starts_at), '[]'::json)
  from public.agent_builder_bookings b
  join public.agent_builder_agents a on a.id = b.agent_id
  where a.tenant_key = p_tenant_key
    and b.status = 'confirmed'
    and b.starts_at >= p_from
    and b.starts_at < p_to
    and (p_station_id is null or b.station_id = p_station_id);
$$;

create or replace function public.list_bookings_for_phone(p_tenant_key text, p_phone text)
returns json
language sql
stable
security invoker
as $$
  select coalesce(json_agg(json_build_object(
    'id', b.id,
    'plate', b.plate,
    'stationId', b.station_id,
    'stationName', b.station_name,
    'groupId', b.group_id,
    'reservationUid', b.reservation_uid,
    'bookingNumber', b.booking_number,
    'startsAt', b.starts_at,
    'endsAt', b.ends_at,
    'status', b.status
  ) order by b.starts_at desc), '[]'::json)
  from public.agent_builder_bookings b
  join public.agent_builder_agents a on a.id = b.agent_id
  where a.tenant_key = p_tenant_key
    and b.phone_key = public.agent_builder_phone_key(p_phone)
    and b.status in ('pending', 'confirmed');
$$;

create or replace function public.mark_booking_cancelled(p_tenant_key text, p_group_id text)
returns integer
language plpgsql
security invoker
as $$
declare
  updated_rows integer;
begin
  update public.agent_builder_bookings b
  set status = 'cancelled', updated_at = now()
  from public.agent_builder_agents a
  where a.id = b.agent_id and a.tenant_key = p_tenant_key and b.group_id = p_group_id and b.status <> 'cancelled';
  get diagnostics updated_rows = row_count;
  return updated_rows;
end;
$$;

create or replace function public.get_customer_context(p_tenant_key text, p_phone text)
returns json
language sql
stable
security invoker
as $$
  select coalesce(c.context, '{}'::jsonb)
  from public.agent_builder_agents a
  left join public.agent_builder_customer_context c
    on c.agent_id = a.id and c.phone_key = public.agent_builder_phone_key(p_phone)
  where a.tenant_key = p_tenant_key;
$$;

create or replace function public.save_customer_context(p_tenant_key text, p_phone text, p_context jsonb)
returns json
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  normalized_phone text;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;
  normalized_phone := public.agent_builder_phone_key(p_phone);
  if normalized_phone is null then raise exception 'phone_required'; end if;
  insert into public.agent_builder_customer_context as c (agent_id, phone_key, phone, context)
  values (target_agent_id, normalized_phone, trim(p_phone), coalesce(p_context, '{}'::jsonb))
  on conflict (agent_id, phone_key) do update
    set phone = excluded.phone, context = excluded.context, updated_at = now();
  return json_build_object('phoneKey', normalized_phone);
end;
$$;

-- Local half of a staging reset. The caller cancels the returned groups in Muster first,
-- then calls this. Chat memory lives in the agent database and is cleared there, not here.
create or replace function public.reset_customer(p_tenant_key text, p_phone text)
returns json
language plpgsql
security invoker
as $$
declare
  target_agent_id uuid;
  normalized_phone text;
  groups json;
  removed_bookings integer;
  removed_context integer;
begin
  select id into target_agent_id from public.agent_builder_agents where tenant_key = p_tenant_key for update;
  if target_agent_id is null then raise exception 'unknown_tenant'; end if;
  normalized_phone := public.agent_builder_phone_key(p_phone);
  if normalized_phone is null then raise exception 'phone_required'; end if;

  select coalesce(json_agg(distinct b.group_id), '[]'::json) into groups
  from public.agent_builder_bookings b
  where b.agent_id = target_agent_id and b.phone_key = normalized_phone and b.status in ('pending', 'confirmed');

  delete from public.agent_builder_bookings b
  where b.agent_id = target_agent_id and b.phone_key = normalized_phone;
  get diagnostics removed_bookings = row_count;

  delete from public.agent_builder_customer_context c
  where c.agent_id = target_agent_id and c.phone_key = normalized_phone;
  get diagnostics removed_context = row_count;

  return json_build_object(
    'phoneKey', normalized_phone,
    'openGroupIds', groups,
    'removedBookings', removed_bookings,
    'removedContext', removed_context
  );
end;
$$;

revoke all on function public.record_booking(text, text, text, integer, text, jsonb, text, text, text, text, timestamptz, timestamptz, text, text) from public;
revoke all on function public.list_bookings(text, timestamptz, timestamptz, integer) from public;
revoke all on function public.list_bookings_for_phone(text, text) from public;
revoke all on function public.mark_booking_cancelled(text, text) from public;
revoke all on function public.get_customer_context(text, text) from public;
revoke all on function public.save_customer_context(text, text, jsonb) from public;
revoke all on function public.reset_customer(text, text) from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.record_booking(text, text, text, integer, text, jsonb, text, text, text, text, timestamptz, timestamptz, text, text) from anon;
    revoke all on function public.list_bookings(text, timestamptz, timestamptz, integer) from anon;
    revoke all on function public.list_bookings_for_phone(text, text) from anon;
    revoke all on function public.mark_booking_cancelled(text, text) from anon;
    revoke all on function public.get_customer_context(text, text) from anon;
    revoke all on function public.save_customer_context(text, text, jsonb) from anon;
    revoke all on function public.reset_customer(text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.record_booking(text, text, text, integer, text, jsonb, text, text, text, text, timestamptz, timestamptz, text, text) from authenticated;
    revoke all on function public.list_bookings(text, timestamptz, timestamptz, integer) from authenticated;
    revoke all on function public.list_bookings_for_phone(text, text) from authenticated;
    revoke all on function public.mark_booking_cancelled(text, text) from authenticated;
    revoke all on function public.get_customer_context(text, text) from authenticated;
    revoke all on function public.save_customer_context(text, text, jsonb) from authenticated;
    revoke all on function public.reset_customer(text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.record_booking(text, text, text, integer, text, jsonb, text, text, text, text, timestamptz, timestamptz, text, text) to service_role;
    grant execute on function public.list_bookings(text, timestamptz, timestamptz, integer) to service_role;
    grant execute on function public.list_bookings_for_phone(text, text) to service_role;
    grant execute on function public.mark_booking_cancelled(text, text) to service_role;
    grant execute on function public.get_customer_context(text, text) to service_role;
    grant execute on function public.save_customer_context(text, text, jsonb) to service_role;
    grant execute on function public.reset_customer(text, text) to service_role;
  end if;
end $$;
