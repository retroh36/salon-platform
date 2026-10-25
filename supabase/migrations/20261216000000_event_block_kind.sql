-- Events hold their team's time on the calendar as blocked time of their
-- own kind (written only by the event: …_event_day.sql). A new enum value
-- can't be used in the transaction that adds it, so it's on its own.
alter type public.time_block_kind add value if not exists 'event';
