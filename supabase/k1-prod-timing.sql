-- Frozen timing facts for later analysis. Written once, when the thing happens, and never updated.
-- A later change to a lead's deadline or status does not rewrite these rows.
--
-- kind = 'sent'       one row per message, at the moment it is sent.
--                     happened_at is the send time. days_before_deadline is the deadline
--                     minus that Helsinki date, using the deadline as it stood then.
-- kind = 'booked'     one row per chat booking, at the moment the booking is stored.
--                     last_sent_at is the last message sent at or before that moment,
--                     and days_after_last_send is the Helsinki-day gap. appointment_at
--                     is the inspection time they booked.
-- kind = 'left_list'  one row per lead, at the moment the morning list sync notices
--                     they are gone. happened_at is when we noticed, not when they booked.
--                     The same gap columns are filled from the last message, if any.

create table if not exists public.k1_prod_timing (
  id uuid primary key default gen_random_uuid(),
  dedupe text not null unique,
  env text not null check (env = any (array['live', 'test'])),
  lead_id uuid,
  kind text not null check (kind = any (array['sent', 'booked', 'left_list'])),
  happened_at timestamptz not null,
  step text,
  message_id uuid,
  booking_id uuid,
  deadline date,
  days_before_deadline integer,
  last_sent_at timestamptz,
  days_after_last_send integer,
  appointment_at timestamptz,
  holdout boolean,
  recorded_at timestamptz not null default now()
);

create index if not exists k1_prod_timing_lead on public.k1_prod_timing (lead_id, happened_at);
create index if not exists k1_prod_timing_kind on public.k1_prod_timing (kind, happened_at);

alter table public.k1_prod_timing enable row level security;
revoke all on public.k1_prod_timing from anon, authenticated;

create or replace function public.k1_prod_timing_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  dl date;
  hold boolean;
  last_id uuid;
  last_step text;
  last_at timestamptz;
  when_at timestamptz;
  hel_days integer;
begin
  if tg_table_name = 'k1_prod_messages_out' then
    if new.sent_at is null or (tg_op = 'UPDATE' and old.sent_at is not null) then return new; end if;
    select l.deadline into dl from public.k1_prod_leads l where l.id = new.lead_id;
    insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, deadline, days_before_deadline)
    values ('sent:' || new.id, new.env, new.lead_id, 'sent', new.sent_at, new.step, new.id, dl,
      case when dl is null then null else dl - (new.sent_at at time zone 'Europe/Helsinki')::date end)
    on conflict (dedupe) do nothing;

  elsif tg_table_name = 'k1_prod_bookings' then
    if new.status = 'cancelled' or exists (select 1 from public.k1_prod_timing t where t.dedupe = 'booked:' || new.id) then return new; end if;
    when_at := coalesce(new.created_at, clock_timestamp());
    select l.deadline, l.holdout into dl, hold from public.k1_prod_leads l where l.id = new.lead_id;
    select m.id, m.step, m.sent_at into last_id, last_step, last_at
      from public.k1_prod_messages_out m
      where m.lead_id = new.lead_id and m.sent_at is not null and m.sent_at <= when_at
      order by m.sent_at desc limit 1;
    insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, booking_id, deadline, days_before_deadline, last_sent_at, days_after_last_send, appointment_at, holdout)
    values ('booked:' || new.id, new.env, new.lead_id, 'booked', when_at, last_step, last_id, new.id, dl,
      case when dl is null then null else dl - (when_at at time zone 'Europe/Helsinki')::date end,
      last_at,
      case when last_at is null then null else (when_at at time zone 'Europe/Helsinki')::date - (last_at at time zone 'Europe/Helsinki')::date end,
      new.starts_at, hold)
    on conflict (dedupe) do nothing;

  elsif tg_table_name = 'k1_prod_leads' then
    if new.left_list_on is null or (tg_op = 'UPDATE' and old.left_list_on is not null) then return new; end if;
    when_at := coalesce(new.updated_at, clock_timestamp());
    select m.id, m.step, m.sent_at into last_id, last_step, last_at
      from public.k1_prod_messages_out m
      where m.lead_id = new.id and m.sent_at is not null and m.sent_at <= when_at
      order by m.sent_at desc limit 1;
    insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, deadline, days_before_deadline, last_sent_at, days_after_last_send, holdout)
    values ('left:' || new.id, new.env, new.id, 'left_list', when_at, last_step, last_id, new.deadline,
      new.deadline - (when_at at time zone 'Europe/Helsinki')::date,
      last_at,
      case when last_at is null then null else (when_at at time zone 'Europe/Helsinki')::date - (last_at at time zone 'Europe/Helsinki')::date end,
      new.holdout)
    on conflict (dedupe) do nothing;
  end if;
  return new;
exception when others then
  return new;
end;
$function$;

drop trigger if exists k1_prod_timing_message on public.k1_prod_messages_out;
create trigger k1_prod_timing_message
  after insert or update of sent_at on public.k1_prod_messages_out
  for each row execute function public.k1_prod_timing_capture();

drop trigger if exists k1_prod_timing_booking on public.k1_prod_bookings;
create trigger k1_prod_timing_booking
  after insert or update of status, starts_at on public.k1_prod_bookings
  for each row execute function public.k1_prod_timing_capture();

drop trigger if exists k1_prod_timing_left on public.k1_prod_leads;
create trigger k1_prod_timing_left
  after update of left_list_on on public.k1_prod_leads
  for each row execute function public.k1_prod_timing_capture();

-- Messages already sent, using the deadline the lead still has. Sending started today, so that deadline has not moved.
insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, deadline, days_before_deadline)
select 'sent:' || m.id, m.env, m.lead_id, 'sent', m.sent_at, m.step, m.id, l.deadline,
  l.deadline - (m.sent_at at time zone 'Europe/Helsinki')::date
from public.k1_prod_messages_out m
join public.k1_prod_leads l on l.id = m.lead_id
where m.sent_at is not null
on conflict (dedupe) do nothing;
