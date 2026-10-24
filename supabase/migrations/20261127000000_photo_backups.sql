-- The backup copy of the files in Storage (lib/photo-backup.ts,
-- docs/operations.md): a private bucket with no policies, so only the
-- service role (the nightly backup and restores) can read or write it.
-- A separate Supabase project is better still (PHOTO_BACKUP_SUPABASE_URL).

insert into storage.buckets (id, name, public)
values ('photo-backups', 'photo-backups', false)
on conflict (id) do nothing;
