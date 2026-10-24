-- The calendar for big salons: the salon's default stylist order (owners
-- set it, on Team → Calendar order or by dragging a column header), and
-- saved views, a named list of stylists in an order ("Hair team",
-- "Color", "My section"): shared with everyone at the location (owners
-- make those) or personal (anyone, for themselves). Which view someone
-- last used is remembered per device (a cookie), not here.

-- ---------------------------------------------------------------------------
-- Default column order: 1, 2, 3… for the people placed; anyone not placed
-- (null, e.g. someone just added) comes after, in the usual order.
-- ---------------------------------------------------------------------------

alter table public.staff add column calendar_position int check (calendar_position > 0);

-- The salon's order, as the list of staff ids from first to last. Ids not
-- on the team are ignored; people left out go to the end.
create function public.set_calendar_order(p_business_id uuid, p_staff_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_business_role(p_business_id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners set the calendar order' using errcode = '42501';
  end if;
  update public.staff s set calendar_position = o.position
  from (
    select id, row_number() over (order by min(n))::int as position
    from unnest(p_staff_ids) with ordinality as u (id, n)
    group by id
  ) o
  where s.id = o.id and s.business_id = p_business_id and s.calendar_position is distinct from o.position;
  update public.staff set calendar_position = null
  where business_id = p_business_id and calendar_position is not null and not (id = any (p_staff_ids));
end;
$$;

revoke all on function public.set_calendar_order(uuid, uuid[]) from public, anon;
grant execute on function public.set_calendar_order(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- calendar_views
-- ---------------------------------------------------------------------------

create table public.calendar_views (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  location_id     uuid not null,
  -- Whose personal view it is; null for a view shared with everyone at
  -- the location.
  owner_staff_id  uuid,
  name            text not null check (length(name) between 1 and 40 and name = trim(name)),
  -- The stylists shown, first to last.
  staff_ids       uuid[] not null check (cardinality(staff_ids) between 1 and 200),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (location_id, business_id) references public.locations (id, business_id) on delete cascade,
  foreign key (owner_staff_id, business_id) references public.staff (id, business_id) on delete cascade,
  foreign key (created_by, business_id) references public.staff (id, business_id) on delete set null (created_by)
);

-- One name per person's own views, and one among the shared ones.
create unique index calendar_views_name_key on public.calendar_views (location_id, owner_staff_id, lower(name)) nulls not distinct;

alter table public.calendar_views enable row level security;

-- Everyone at the salon sees the shared views, and their own. Written only
-- through the functions below.
create policy "Staff see shared views and their own" on public.calendar_views for select to authenticated
  using (
    (select private.is_business_member(business_id))
    and (owner_staff_id is null or (select private.is_current_staff(business_id, owner_staff_id)))
  );

-- Saves a view (p_view_id null: a new one) and returns its id. Shared
-- views are for owners to make and change; personal ones are their
-- owner's. Stylists not on the team are dropped; duplicates keep their
-- first place.
create function public.save_calendar_view(p_location_id uuid, p_view_id uuid, p_name text, p_staff_ids uuid[], p_shared boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := (select business_id from public.locations where id = p_location_id);
  v_me uuid := private.current_staff_id(v_business);
  v_owner boolean := private.has_business_role(v_business, array['owner']::public.staff_role[]);
  v_view public.calendar_views;
  v_staff uuid[];
  v_id uuid := p_view_id;
begin
  if v_me is null then
    raise exception 'Not at this salon' using errcode = '42501';
  end if;
  if p_shared and not v_owner then
    raise exception 'Only owners make views for everyone' using errcode = '42501';
  end if;
  select array_agg(id order by n) into v_staff
  from (
    select u.id, min(u.n) as n
    from unnest(p_staff_ids) with ordinality as u (id, n)
    join public.staff s on s.id = u.id and s.business_id = v_business
    group by u.id
  ) x;
  if coalesce(cardinality(v_staff), 0) = 0 then
    raise exception 'Choose at least one stylist' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.calendar_views (business_id, location_id, owner_staff_id, name, staff_ids, created_by)
    values (v_business, p_location_id, case when p_shared then null else v_me end, trim(p_name), v_staff, v_me)
    returning id into v_id;
  else
    select * into v_view from public.calendar_views where id = v_id and location_id = p_location_id;
    -- Your own view, or (owners) a shared one.
    -- (coalesce: a shared view has no owner, and null mustn't let anyone in.)
    if v_view.id is null or not coalesce(v_view.owner_staff_id = v_me or (v_view.owner_staff_id is null and v_owner), false) then
      raise exception 'Not your view to change' using errcode = '42501';
    end if;
    update public.calendar_views
    set name = trim(p_name), staff_ids = v_staff, owner_staff_id = case when p_shared then null else v_me end, updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create function public.delete_calendar_view(p_view_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view public.calendar_views := (select v from public.calendar_views v where v.id = p_view_id);
begin
  if v_view.id is null
     or not coalesce(
       v_view.owner_staff_id = private.current_staff_id(v_view.business_id)
       or (v_view.owner_staff_id is null and private.has_business_role(v_view.business_id, array['owner']::public.staff_role[])),
       false
     ) then
    raise exception 'Not your view to delete' using errcode = '42501';
  end if;
  delete from public.calendar_views where id = p_view_id;
end;
$$;

revoke all on function public.save_calendar_view(uuid, uuid, text, uuid[], boolean) from public, anon;
revoke all on function public.delete_calendar_view(uuid) from public, anon;
grant execute on function public.save_calendar_view(uuid, uuid, text, uuid[], boolean) to authenticated;
grant execute on function public.delete_calendar_view(uuid) to authenticated;
