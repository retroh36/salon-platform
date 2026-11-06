-- Color as a product type of its own (shades: permanent, demi and toners),
-- next to back bar and retail. Its own migration: a new enum value can't be
-- used in the transaction that adds it (the rules follow in
-- …_color_type_rules.sql).

alter type public.product_type add value if not exists 'color' after 'back_bar';
