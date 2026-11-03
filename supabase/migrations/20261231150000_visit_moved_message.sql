-- "Your visit has moved": the message staff send a client after one of
-- Denise's fixes moved their visit (lib/messaging/templates.ts). Applying a
-- fix sends nothing; staff check the message and send it through
-- send_client_message, which logs it like any other.
alter table public.client_messages drop constraint client_messages_template_check;
alter table public.client_messages add constraint client_messages_template_check
  check (template in ('running_late', 'please_call', 'need_to_move', 'reminder', 'ready_early', 'visit_moved', 'stylist_out_covered', 'stylist_out_moved', 'custom', 'special'));
