-- End-of-day close-out: the cash the day's sales say should be in the
-- drawer (cash taken less refunds), what was counted, and the difference.
-- One per location per day; owners record it on the Reports page.

create table public.cash_closeouts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  location_id      uuid not null,
  day              date not null,
  expected_cents   integer not null,
  counted_cents    integer not null check (counted_cents >= 0),
  note             text check (length(note) <= 500),
  closed_by        uuid,
  closed_at        timestamptz not null default now(),
  unique (location_id, day),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (closed_by, business_id) references public.staff (id, business_id) on delete set null (closed_by)
);

alter table public.cash_closeouts enable row level security;

create policy "Owners can view close-outs" on public.cash_closeouts for select to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));

-- Records (or corrects) a day's close-out. The expected cash is worked out
-- here from the day's payments, not taken from the caller.
create function public.save_closeout(p_location_id uuid, p_day date, p_counted_cents integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_tz text;
  v_expected integer;
begin
  select l.business_id, l.timezone into v_business_id, v_tz from public.locations l where l.id = p_location_id;
  if v_business_id is null or not private.has_business_role(v_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners can close out the day' using errcode = '42501';
  end if;
  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'Enter the cash counted' using errcode = '22023';
  end if;
  select coalesce(sum(p.amount_cents), 0)::int into v_expected
  from public.payments p
  where p.location_id = p_location_id and p.method = 'cash'
    and p.created_at >= (p_day::timestamp at time zone v_tz) and p.created_at < ((p_day + 1)::timestamp at time zone v_tz);

  insert into public.cash_closeouts (business_id, location_id, day, expected_cents, counted_cents, note, closed_by)
  values (v_business_id, p_location_id, p_day, v_expected, p_counted_cents, nullif(trim(p_note), ''), private.current_staff_id(v_business_id))
  on conflict (location_id, day) do update set
    expected_cents = excluded.expected_cents, counted_cents = excluded.counted_cents, note = excluded.note,
    closed_by = excluded.closed_by, closed_at = now();
  return p_counted_cents - v_expected;
end;
$$;

revoke all on function public.save_closeout(uuid, date, integer, text) from public, anon;
grant execute on function public.save_closeout(uuid, date, integer, text) to authenticated;
