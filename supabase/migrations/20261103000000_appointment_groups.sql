-- Group bookings: several clients booked as one party (a bridal party,
-- friends, a parent and children), at the same time with different
-- stylists or staggered. Each guest's visit is an ordinary appointment,
-- booked through the booking rules, linked to the group, which carries a
-- shared label. Moving or canceling can apply to the whole group
-- (lib/scheduling/group-book.ts), and Denise's resolver keeps groups
-- together when it can (lib/scheduling/resolve.ts).

create table public.appointment_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  location_id  uuid not null,
  label        text not null check (length(trim(label)) > 0 and length(label) <= 80),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (id, business_id),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

create index appointment_groups_business_id_idx on public.appointment_groups (business_id);
create index appointment_groups_location_id_idx on public.appointment_groups (location_id);

alter table public.appointments
  add column group_id uuid,
  add foreign key (group_id, business_id) references public.appointment_groups (id, business_id) on delete set null (group_id);

create index appointments_group_idx on public.appointments (group_id) where group_id is not null;

alter table public.appointment_groups enable row level security;

create policy "Members can view groups"
  on public.appointment_groups for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Front of house can start groups"
  on public.appointment_groups for insert to authenticated
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));
create policy "Front of house can rename groups"
  on public.appointment_groups for update to authenticated
  using ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner', 'manager', 'front_desk']::public.staff_role[])));

-- Puts a booked visit in a group, or takes it out (null), front of house
-- only. Appointments can't be written directly.
create function public.set_appointment_group(p_appointment_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_group public.appointment_groups;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if v_appointment.id is null
     or not private.has_business_role(v_appointment.business_id, array['owner', 'manager', 'front_desk']::public.staff_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_group_id is not null then
    select * into v_group from public.appointment_groups where id = p_group_id;
    if v_group.id is null or v_group.business_id <> v_appointment.business_id then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    if v_group.location_id <> v_appointment.location_id then
      raise exception 'A group is at one location' using errcode = '22023';
    end if;
  end if;
  update public.appointments set group_id = p_group_id where id = p_appointment_id;
end;
$$;

revoke all on function public.set_appointment_group(uuid, uuid) from public, anon;
grant execute on function public.set_appointment_group(uuid, uuid) to authenticated;
