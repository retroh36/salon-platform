-- Assistants: they see the day of the stylist they assist (staff
-- .assists_staff_id, next migration). A new enum value can't be used in the
-- transaction that adds it, so it has its own migration.
alter type public.staff_role add value if not exists 'assistant';
