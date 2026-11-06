-- Color works like back bar: used in services (formulas and recipes), by
-- weight or volume, with no retail price. Only retail needs a price, and
-- color is never counted in units.

alter table public.products drop constraint products_check2;
alter table public.products add constraint products_retail_price check (type <> 'retail' or price_cents is not null);
alter table public.products add constraint products_color_measured check (type <> 'color' or unit <> 'unit');

-- Formulas and recipes take color as well as back bar.
do $$
declare
  v_fn text;
  v_def text;
  v_old text;
begin
  foreach v_fn in array array['public.add_formula(uuid,uuid,date,text,text,jsonb)', 'public.set_service_recipe(uuid,jsonb)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    v_old := case when v_fn like '%add_formula%' then 'v_product.type <> ''back_bar''' else 'p.type <> ''back_bar''' end;
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '% changed: update this migration', v_fn;
    end if;
    execute replace(v_def, v_old, replace(v_old, '<> ''back_bar''', 'not in (''back_bar'', ''color'')'));
  end loop;
end;
$$;
