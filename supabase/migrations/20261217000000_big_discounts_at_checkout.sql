-- complete_sale's discount limit follows the big_discounts permission
-- again. The permissions migration moved it onto private.can, then the
-- promotions migration rewrote complete_sale with the old owner-or-manager
-- check, so a front desk member allowed big discounts was refused and a
-- manager whose switch was off could still give any discount.

do $$
declare
  v_fn regprocedure := 'public.complete_sale(uuid,jsonb)';
  v_def text := pg_get_functiondef(v_fn);
  v_old text := E'not private.has_business_role(v_business.id, array[''owner'', ''manager'']::public.staff_role[])\n       and (v_discount + v_line_discounts)';
  v_new text := E'not private.can(v_business.id, ''big_discounts'')\n       and (v_discount + v_line_discounts)';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'complete_sale''s discount check isn''t as expected';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
