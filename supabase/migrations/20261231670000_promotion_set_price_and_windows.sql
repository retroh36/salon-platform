-- Promotions: a set price ("$30 blowout", discount_kind 'price', amount_cents
-- per unit: never raises a line that's already less) and weekday and time
-- windows (days 1 Monday to 7 Sunday, from_minute and to_minute at the
-- salon, checked against when the visit starts, or now for a sale without
-- a visit). An automatic promotion with a window can show on the booking
-- site's matching times, like a last-minute special, and the visit holds it.

alter table public.promotions
  drop constraint promotions_discount_kind_check,
  drop constraint promotions_check2,
  add constraint promotions_discount_kind_check check (discount_kind in ('percent', 'amount', 'price')),
  add constraint promotions_discount_value check ((discount_kind = 'percent') = (percent is not null) and (discount_kind in ('amount', 'price')) = (amount_cents is not null)),
  add column days smallint[] check (cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  add column from_minute integer,
  add column to_minute integer,
  add constraint promotions_window check ((from_minute is null) = (to_minute is null) and (from_minute is null or (from_minute >= 0 and from_minute < to_minute and to_minute <= 1440)));

do $$
declare
  v_def text;
  v_pairs text[][];
  i integer;
begin
  -- The window, in private.promotion_problem.
  v_def := pg_get_functiondef('private.promotion_problem(public.promotions,text,uuid,uuid,integer,date)'::regprocedure);
  v_pairs := array[
    array[
      $o$  v_a public.appointments;
begin$o$,
      $n$  v_a public.appointments;
  v_local timestamp;
  v_minute integer;
begin$n$],
    array[
      $o$  if p.kind = 'last_minute' then$o$,
      $n$  if p.days is not null or p.from_minute is not null then
    select * into v_a from public.appointments where id = p_appointment_id;
    select l.timezone into v_tz from public.locations l
    where l.business_id = p.business_id and (v_a.id is null or l.id = v_a.location_id) order by l.created_at limit 1;
    v_local := coalesce(v_a.starts_at, now()) at time zone v_tz;
    v_minute := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
    if (p.days is not null and not extract(isodow from v_local)::smallint = any(p.days))
       or (p.from_minute is not null and (v_minute < p.from_minute or v_minute >= p.to_minute)) then
      return p.name || ' isn''t on at this day and time.';
    end if;
  end if;
  if p.kind = 'last_minute' then$n$]
  ];
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'promotion_problem changed: update this migration (%)', i;
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;

  -- save_promotion keeps the window.
  v_def := pg_get_functiondef('public.save_promotion(uuid,uuid,jsonb)'::regprocedure);
  v_pairs := array[
    array[
      $o$  v.hours_ahead := (p_input ->> 'hours_ahead')::int;$o$,
      $n$  v.hours_ahead := (p_input ->> 'hours_ahead')::int;
  v_list := case when jsonb_typeof(p_input -> 'days') = 'array' then p_input -> 'days' end;
  v.days := (select array_agg(distinct x::smallint) from jsonb_array_elements_text(v_list) x);
  v.from_minute := (p_input ->> 'from_minute')::int;
  v.to_minute := (p_input ->> 'to_minute')::int;$n$],
    array[
      $o$min_spend_cents, stackable, online, hours_ahead) =$o$,
      $n$min_spend_cents, stackable, online, hours_ahead, days, from_minute, to_minute) =$n$],
    array[
      $o$v.stackable, v.online, v.hours_ahead)$o$,
      $n$v.stackable, v.online, v.hours_ahead, v.days, v.from_minute, v.to_minute)$n$]
  ];
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'save_promotion changed: update this migration (%)', i;
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;

  -- A visit booked online can hold an automatic promotion with a window.
  v_def := pg_get_functiondef('public.attach_online_promotion(uuid,uuid)'::regprocedure);
  v_pairs := array[
    array[
      $o$or v_p.kind = 'automatic' then$o$,
      $n$or (v_p.kind = 'automatic' and v_p.days is null and v_p.from_minute is null) then$n$]
  ];
  if (length(v_def) - length(replace(v_def, v_pairs[1][1], ''))) / length(v_pairs[1][1]) <> 1 then
    raise exception 'attach_online_promotion changed: update this migration';
  end if;
  execute replace(v_def, v_pairs[1][1], v_pairs[1][2]);

  -- complete_sale prices a set price per unit, on the service and the
  -- product lines alike (as applyPromotions in lib/promotions.ts).
  v_def := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_pairs := array[
    array[
      $o$then round(v_left::numeric * v_promo.percent / 100)::int else least(v_left, v_pool[j]) end;$o$,
      $n$then round(v_left::numeric * v_promo.percent / 100)::int when v_promo.discount_kind = 'price' then greatest(0, v_left - v_promo.amount_cents * v_qty) else least(v_left, v_pool[j]) end;$n$]
  ];
  if (length(v_def) - length(replace(v_def, v_pairs[1][1], ''))) / length(v_pairs[1][1]) <> 2 then
    raise exception 'complete_sale changed: update this migration';
  end if;
  execute replace(v_def, v_pairs[1][1], v_pairs[1][2]);
end;
$$;
