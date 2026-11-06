-- The stylist hears first: when Denise's risk check sees a visit likely to
-- run into the next client (lib/denise/risk.ts), the stylist gets an app
-- notice on My day straight away, and the front desk sees her fix only
-- after a grace period (HEADS_UP_MINUTES in lib/denise/risk.ts), or at once
-- if the stylist reports running late (a reported overrun, which the risk
-- check then leaves to the report).
--
-- One heads-up per visit and stylist: `overrun_heads_ups` says when it was
-- given, which starts the front desk's grace. Written only through
-- record_overrun_heads_up, with the notice's words from our code (a fixed
-- template, never Claude's); read by the front of house and the stylist.

create table public.overrun_heads_ups (
  appointment_id uuid not null,
  staff_id uuid not null,
  business_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  notified_at timestamptz not null default now(),
  primary key (appointment_id, staff_id),
  foreign key (appointment_id) references public.appointments (id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff (id, business_id) on delete cascade
);

alter table public.overrun_heads_ups enable row level security;

create policy "Front of house and the stylist read heads-ups" on public.overrun_heads_ups
  for select to authenticated
  -- A small table (one row a visit at risk), so the per-row my_book is fine.
  using (business_id in (select private.front_of_house_businesses()) or staff_id = any (private.my_book(business_id)));

-- Records the heads-up for an item's visit and stylist, once, with its app
-- notice; returns when the stylist was told (p_at, the clock of the look at
-- the day that found it, or the first time). It only times the desk's wait.
-- Anyone at the salon whose look at the day found it (the server, or the
-- person whose calendar ran the check) may record it.
create function public.record_overrun_heads_up(p_item_id uuid, p_body text, p_at timestamptz default now())
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.appointment_items;
  v_at timestamptz;
begin
  select * into v_item from public.appointment_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
  if auth.uid() is not null and v_item.business_id not in (select private.member_businesses()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_body is null or length(trim(p_body)) = 0 or length(p_body) > 1000 then
    raise exception 'The notice needs its words' using errcode = '22023';
  end if;

  insert into public.overrun_heads_ups (appointment_id, staff_id, business_id, location_id, item_id, notified_at)
  values (v_item.appointment_id, v_item.staff_id, v_item.business_id, v_item.location_id, v_item.id, coalesce(p_at, now()))
  on conflict do nothing
  returning notified_at into v_at;
  if v_at is null then
    select notified_at into v_at from public.overrun_heads_ups where appointment_id = v_item.appointment_id and staff_id = v_item.staff_id;
    return v_at;
  end if;

  insert into public.notifications (business_id, location_id, appointment_id, staff_id, channel, template, body, status)
  values (v_item.business_id, v_item.location_id, v_item.appointment_id, v_item.staff_id, 'app', 'likely_overrun', p_body, 'sent');
  return v_at;
end;
$$;

revoke all on function public.record_overrun_heads_up(uuid, text, timestamptz) from public, anon;
grant execute on function public.record_overrun_heads_up(uuid, text, timestamptz) to authenticated, service_role;
