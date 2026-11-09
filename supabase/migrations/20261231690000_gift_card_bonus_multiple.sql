-- A gift card bonus can be a multiple of the normal earn rate (the salon's
-- points per dollar on services) on the gift card amount, as well as a
-- fixed number of points: "double points on gift cards $100+".

alter table public.points_offers
  drop constraint points_offers_check1,
  drop constraint points_offers_check3,
  add constraint points_offers_multiplier_kind check (kind <> 'multiplier' or (multiplier is not null and bonus_points is null and min_gift_card_cents is null)),
  add constraint points_offers_gift_card_kind check (kind <> 'gift_card_bonus' or (min_gift_card_cents is not null and (bonus_points is null) <> (multiplier is null)));

do $$
declare
  v_def text;
  v_pairs text[][];
  i integer;
begin
  v_def := pg_get_functiondef('private.earn_sale_points(uuid)'::regprocedure);
  v_pairs := array[
    array[
      $o$  v_gift public.points_offers;
begin$o$,
      $n$  v_gift public.points_offers;
  v_gift_points integer;
begin$n$],
    array[
      $o$    order by o.bonus_points desc, o.created_at limit 1;
    if v_gift.id is not null then$o$,
      $n$    order by coalesce(o.bonus_points, floor(v_gift_cents * v_program.service_points_per_dollar * o.multiplier / 100.0)::int) desc, o.created_at limit 1;
    v_gift_points := coalesce(v_gift.bonus_points, floor(v_gift_cents * v_program.service_points_per_dollar * v_gift.multiplier / 100.0)::int);
    if v_gift.id is not null and v_gift_points > 0 then$n$],
    array[
      $o$values (v_sale.business_id, v_earner, v_gift.bonus_points, 'bonus', 'gift_card',$o$,
      $n$values (v_sale.business_id, v_earner, v_gift_points, 'bonus', 'gift_card',$n$]
  ];
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'earn_sale_points changed: update this migration (%)', i;
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;

  v_def := pg_get_functiondef('public.save_points_offer(uuid,uuid,jsonb)'::regprocedure);
  v_pairs := array[array[
    $o$case when v_multiplier then (p_input ->> 'multiplier')::numeric end,$o$,
    $n$(p_input ->> 'multiplier')::numeric,$n$]];
  if (length(v_def) - length(replace(v_def, v_pairs[1][1], ''))) / length(v_pairs[1][1]) <> 1 then
    raise exception 'save_points_offer changed: update this migration';
  end if;
  execute replace(v_def, v_pairs[1][1], v_pairs[1][2]);
end;
$$;
