-- WhatsApp turns recorded after the reply is sent.
-- link_host stays 'staging' for an assigned staging test and 'live' for a customer
-- who was not assigned one, so logging a live chat does not switch its booking link.
-- inbound_message_id makes a retried turn a no-op instead of a second pair of messages.

alter table public.k1_staging_conversations
  add column if not exists link_host text not null default 'staging';

alter table public.k1_staging_messages
  add column if not exists inbound_message_id text;

create unique index if not exists k1_staging_messages_inbound_user
  on public.k1_staging_messages (conversation_id, inbound_message_id)
  where inbound_message_id is not null and role = 'user';
