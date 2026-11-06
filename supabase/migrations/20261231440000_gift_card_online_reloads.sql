-- Online gift card reloads, on or off per salon (Settings → Gift cards,
-- on by default). Off, clients still see their cards and add them by code,
-- but can't top them up online: the account hides Reload, the reload page
-- sends them back, and reload_gift_card_online refuses (hint
-- reloads_off). A reload already charged and recorded is still returned
-- as before, so a repeat of it never fails.

alter table public.businesses add column gift_card_online_reload boolean not null default true;

create function public.set_gift_card_online_reload(p_business_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can(p_business_id, 'settings') then
    raise exception 'Only owners and managers can change gift card settings' using errcode = '42501';
  end if;
  update public.businesses set gift_card_online_reload = coalesce(p_on, true) where id = p_business_id;
end;
$$;

revoke all on function public.set_gift_card_online_reload(uuid, boolean) from public, anon;
grant execute on function public.set_gift_card_online_reload(uuid, boolean) to authenticated;

do $$
declare
  v_def text := pg_get_functiondef('public.reload_gift_card_online(uuid,uuid,uuid,uuid,integer,text,text,text)'::regprocedure);
  v_from text := '  select * into v_card from public.gift_cards where id = p_card_id and business_id = p_business_id for update;';
  v_to text := '  if not (select gift_card_online_reload from public.businesses where id = p_business_id) then
    raise exception ''This salon doesn''''t take gift card reloads online'' using errcode = ''55000'', hint = ''reloads_off'';
  end if;
' || v_from;
begin
  if (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 then
    raise exception 'reload_gift_card_online: expected the card lookup once';
  end if;
  execute replace(v_def, v_from, v_to);
end;
$$;
