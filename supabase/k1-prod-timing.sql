-- Frozen timing facts for later analysis. Written once, when the thing happens, and never updated.
-- A later change to a lead's deadline or status does not rewrite these rows.
-- The lead column is the whole lead row as it stood at that moment, so the deadline,
-- the station and the rest are still here after the lead has left K1's list.
-- The messages column is every reminder sent to that lead up to that moment.
--
-- kind = 'seen'       one row per lead per day it was still on the list.
-- kind = 'sent'       one row per message, at the moment it is sent.
--                     happened_at is the send time. days_before_deadline is the deadline
--                     minus that Helsinki date.
-- kind = 'booked'     one row per chat booking. last_sent_at is the last message at or
--                     before that moment, days_after_last_send is the Helsinki-day gap,
--                     and appointment_at is the inspection time they booked.
-- kind = 'left_list'  one row per lead, when the morning list sync notices they are gone.
--                     happened_at is when we noticed, not when they booked.

create table if not exists public.k1_prod_timing (
  id uuid primary key default gen_random_uuid(),
  dedupe text not null unique,
  env text not null check (env = any (array['live', 'test'])),
  lead_id uuid,
  kind text not null check (kind = any (array['sent', 'booked', 'left_list', 'seen'])),
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
  lead jsonb,
  messages jsonb,
  recorded_at timestamptz not null default now()
);

alter table public.k1_prod_timing add column if not exists lead jsonb;
alter table public.k1_prod_timing add column if not exists messages jsonb;
alter table public.k1_prod_timing drop constraint if exists k1_prod_timing_kind_check;
alter table public.k1_prod_timing add constraint k1_prod_timing_kind_check check (kind = any (array['sent', 'booked', 'left_list', 'seen']));

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
  lead_row jsonb;
  msgs jsonb;
  last_id uuid;
  last_step text;
  last_at timestamptz;
  when_at timestamptz;
begin
  if tg_table_name = 'k1_prod_messages_out' then
    if new.sent_at is null or (tg_op = 'UPDATE' and old.sent_at is not null) then return new; end if;
    select to_jsonb(l), l.deadline, l.holdout into lead_row, dl, hold from public.k1_prod_leads l where l.id = new.lead_id;
    select coalesce(jsonb_agg(jsonb_build_object('message_id', m.id, 'step', m.step, 'sent_at', m.sent_at, 'days_before_deadline', case when dl is null then null else dl - (m.sent_at at time zone 'Europe/Helsinki')::date end) order by m.sent_at), '[]'::jsonb)
      into msgs from public.k1_prod_messages_out m where m.lead_id = new.lead_id and m.sent_at is not null and m.sent_at <= new.sent_at;
    insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, deadline, days_before_deadline, holdout, lead, messages)
    values ('sent:' || new.id, new.env, new.lead_id, 'sent', new.sent_at, new.step, new.id, dl,
      case when dl is null then null else dl - (new.sent_at at time zone 'Europe/Helsinki')::date end, hold, lead_row, msgs)
    on conflict (dedupe) do nothing;

  elsif tg_table_name = 'k1_prod_bookings' then
    if new.status = 'cancelled' or exists (select 1 from public.k1_prod_timing t where t.dedupe = 'booked:' || new.id) then return new; end if;
    when_at := coalesce(new.created_at, clock_timestamp());
    select to_jsonb(l), l.deadline, l.holdout into lead_row, dl, hold from public.k1_prod_leads l where l.id = new.lead_id;
    select coalesce(jsonb_agg(jsonb_build_object('message_id', m.id, 'step', m.step, 'sent_at', m.sent_at, 'days_before_deadline', case when dl is null then null else dl - (m.sent_at at time zone 'Europe/Helsinki')::date end) order by m.sent_at), '[]'::jsonb)
      into msgs from public.k1_prod_messages_out m where m.lead_id = new.lead_id and m.sent_at is not null and m.sent_at <= when_at;
    select m.id, m.step, m.sent_at into last_id, last_step, last_at from public.k1_prod_messages_out m
      where m.lead_id = new.lead_id and m.sent_at is not null and m.sent_at <= when_at order by m.sent_at desc limit 1;
    insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, booking_id, deadline, days_before_deadline, last_sent_at, days_after_last_send, appointment_at, holdout, lead, messages)
    values ('booked:' || new.id, new.env, new.lead_id, 'booked', when_at, last_step, last_id, new.id, dl,
      case when dl is null then null else dl - (when_at at time zone 'Europe/Helsinki')::date end, last_at,
      case when last_at is null then null else (when_at at time zone 'Europe/Helsinki')::date - (last_at at time zone 'Europe/Helsinki')::date end,
      new.starts_at, hold, lead_row, msgs)
    on conflict (dedupe) do nothing;

  elsif tg_table_name = 'k1_prod_leads' then
    if new.last_seen_on is not null and (tg_op = 'INSERT' or old.last_seen_on is distinct from new.last_seen_on) then
      insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, deadline, days_before_deadline, holdout, lead)
      values ('seen:' || new.id || ':' || new.last_seen_on, new.env, new.id, 'seen', coalesce(new.updated_at, new.last_seen_on::timestamp at time zone 'Europe/Helsinki'), new.deadline,
        new.deadline - new.last_seen_on, new.holdout, to_jsonb(new))
      on conflict (dedupe) do nothing;
    end if;
    if new.left_list_on is not null and (tg_op = 'INSERT' or old.left_list_on is null) then
      when_at := coalesce(new.updated_at, clock_timestamp());
      select coalesce(jsonb_agg(jsonb_build_object('message_id', m.id, 'step', m.step, 'sent_at', m.sent_at, 'days_before_deadline', new.deadline - (m.sent_at at time zone 'Europe/Helsinki')::date) order by m.sent_at), '[]'::jsonb)
        into msgs from public.k1_prod_messages_out m where m.lead_id = new.id and m.sent_at is not null and m.sent_at <= when_at;
      select m.id, m.step, m.sent_at into last_id, last_step, last_at from public.k1_prod_messages_out m
        where m.lead_id = new.id and m.sent_at is not null and m.sent_at <= when_at order by m.sent_at desc limit 1;
      insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, deadline, days_before_deadline, last_sent_at, days_after_last_send, holdout, lead, messages)
      values ('left:' || new.id, new.env, new.id, 'left_list', when_at, last_step, last_id, new.deadline,
        new.deadline - (when_at at time zone 'Europe/Helsinki')::date, last_at,
        case when last_at is null then null else (when_at at time zone 'Europe/Helsinki')::date - (last_at at time zone 'Europe/Helsinki')::date end,
        new.holdout, to_jsonb(new), msgs)
      on conflict (dedupe) do nothing;
    end if;
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
drop trigger if exists k1_prod_timing_lead on public.k1_prod_leads;
create trigger k1_prod_timing_lead
  after insert or update of last_seen_on, left_list_on on public.k1_prod_leads
  for each row execute function public.k1_prod_timing_capture();

-- Messages already sent. The lead copied here is the one still on the row; sending started today, so it has not moved.
insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, step, message_id, deadline, days_before_deadline, holdout, lead, messages)
select 'sent:' || m.id, m.env, m.lead_id, 'sent', m.sent_at, m.step, m.id, l.deadline,
  l.deadline - (m.sent_at at time zone 'Europe/Helsinki')::date, l.holdout, to_jsonb(l),
  (select coalesce(jsonb_agg(jsonb_build_object('message_id', x.id, 'step', x.step, 'sent_at', x.sent_at, 'days_before_deadline', l.deadline - (x.sent_at at time zone 'Europe/Helsinki')::date) order by x.sent_at), '[]'::jsonb)
   from public.k1_prod_messages_out x where x.lead_id = m.lead_id and x.sent_at is not null and x.sent_at <= m.sent_at)
from public.k1_prod_messages_out m
join public.k1_prod_leads l on l.id = m.lead_id
where m.sent_at is not null
on conflict (dedupe) do update set lead = excluded.lead, messages = excluded.messages, holdout = excluded.holdout
  where public.k1_prod_timing.lead is null;

-- One copy of every lead for each day it has been seen on the list.
insert into public.k1_prod_timing (dedupe, env, lead_id, kind, happened_at, deadline, days_before_deadline, holdout, lead)
select 'seen:' || l.id || ':' || l.last_seen_on, l.env, l.id, 'seen', coalesce(l.updated_at, l.last_seen_on::timestamp at time zone 'Europe/Helsinki'),
  l.deadline, l.deadline - l.last_seen_on, l.holdout, to_jsonb(l)
from public.k1_prod_leads l
where l.last_seen_on is not null
on conflict (dedupe) do nothing;
