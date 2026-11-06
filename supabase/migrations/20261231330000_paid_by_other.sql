-- "Other" as a way to pay (Coterie's 2c, "paid by other"): anything that
-- isn't cash, a card or Maestra's own credit, such as a check or a
-- transfer. The rules for it are in …_paid_by_other_rules.sql: a new enum
-- value can't be used in the transaction that adds it.
alter type public.payment_method add value if not exists 'other' after 'card';
