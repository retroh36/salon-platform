-- "This is a gift": a gift card sold as a gift stays out of the buyer's
-- client account (and anyone's) until it's first used; then it belongs to
-- the client it was used for (holder_client_id), and shows in their
-- account only. Staff always see it. owner_client_id is whose card it is
-- now: the holder for a gift, else the client it was sold to.

alter table public.gift_cards
  add column is_gift boolean not null default false,
  add column holder_client_id uuid references public.clients (id) on delete set null,
  add column owner_client_id uuid generated always as (case when is_gift then holder_client_id else client_id end) stored;
create index gift_cards_owner_idx on public.gift_cards (owner_client_id) where owner_client_id is not null;

-- complete_sale: a gift card line can be a gift, and the first use of a
-- gift on a sale with a client makes them its holder.
do $$
declare
  v_def text := pg_get_functiondef('public.complete_sale(uuid,jsonb)'::regprocedure);
  v_pairs text[][] := array[
    array[
      $o$'recipient_name', nullif(trim(v_line ->> 'recipient_name'), ''), 'recipient_email', nullif(trim(v_line ->> 'recipient_email'), ''));$o$,
      $n$'recipient_name', nullif(trim(v_line ->> 'recipient_name'), ''), 'recipient_email', nullif(trim(v_line ->> 'recipient_email'), ''),
        'is_gift', coalesce((v_line ->> 'is_gift')::boolean, false));$n$],
    array[
      $o$client_id, recipient_name, recipient_email, physical, sale_id, created_by)
      values ($o$,
      $n$client_id, recipient_name, recipient_email, physical, sale_id, created_by, is_gift)
      values ($n$],
    array[
      $o$v_rows -> i ->> 'code' is not null, v_sale_id, v_me)$o$,
      $n$v_rows -> i ->> 'code' is not null, v_sale_id, v_me, coalesce((v_rows -> i ->> 'is_gift')::boolean, false))$n$],
    array[
      $o$      perform private.move_gift_card(v_card, 'redeemed', -(v_pay ->> 'amount_cents')::int, v_sale_id, null);$o$,
      $n$      perform private.move_gift_card(v_card, 'redeemed', -(v_pay ->> 'amount_cents')::int, v_sale_id, null);
      if v_card.is_gift and v_card.holder_client_id is null and v_client_id is not null then
        update public.gift_cards set holder_client_id = v_client_id where id = v_card.id;
      end if;$n$]
  ];
  i integer;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    if (length(v_def) - length(replace(v_def, v_pairs[i][1], ''))) / length(v_pairs[i][1]) <> 1 then
      raise exception 'complete_sale changed: update this migration (%)', i;
    end if;
    v_def := replace(v_def, v_pairs[i][1], v_pairs[i][2]);
  end loop;
  execute v_def;
end;
$$;
