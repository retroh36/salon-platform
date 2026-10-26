-- Client notes say who last changed them and when (the client profile
-- shows it under the notes). Set only by the trigger: whatever an update
-- sends for these two columns, they change only when the notes do, to the
-- signed-in staff member and now.

alter table public.clients
  add column notes_updated_at timestamptz,
  add column notes_updated_by uuid,
  add foreign key (notes_updated_by, business_id)
    references public.staff (id, business_id) on delete set null (notes_updated_by);

create index clients_notes_updated_by_idx on public.clients (notes_updated_by) where notes_updated_by is not null;

create function private.stamp_client_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.notes is null then
      new.notes_updated_at := null;
      new.notes_updated_by := null;
    else
      new.notes_updated_at := now();
      new.notes_updated_by := private.current_staff_id(new.business_id);
    end if;
  elsif new.notes is distinct from old.notes then
    new.notes_updated_at := now();
    new.notes_updated_by := private.current_staff_id(new.business_id);
  else
    new.notes_updated_at := old.notes_updated_at;
    new.notes_updated_by := old.notes_updated_by;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_client_notes() from public;

create trigger clients_stamp_notes before insert or update on public.clients
  for each row execute function private.stamp_client_notes();
