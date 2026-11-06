-- The bookkeeper (Coterie's 3b): a sixth role that sees the money and none
-- of the calendar or client details. Its access is the next migration
-- (…_bookkeeper_access.sql): a new enum value can't be used in the
-- transaction that adds it.
alter type public.staff_role add value if not exists 'bookkeeper' after 'assistant';
