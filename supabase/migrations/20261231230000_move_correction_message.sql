-- "Please ignore our last message": the correction staff send a client who
-- was told about one of Denise's fixes that was then undone
-- (lib/messaging/templates.ts, visit_move_undone). Undoing sends nothing;
-- staff check it and send it through send_client_message, logged like any
-- other.
alter table public.client_messages drop constraint client_messages_template_check;
alter table public.client_messages add constraint client_messages_template_check
  check (template in ('running_late', 'please_call', 'need_to_move', 'reminder', 'ready_early', 'visit_moved', 'visit_move_undone', 'stylist_out_covered', 'stylist_out_moved', 'custom', 'special'));
