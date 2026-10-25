-- Anyone with the settings permission (managers, by default) could update
-- any column of their business directly. Two shouldn't be theirs:
-- free_text_roles (owners choose who writes their own messages, as
-- set_free_text_roles says), and next_sale_number, which only ever goes
-- up as sales are made: set lower, every checkout clashed with a sale
-- number already used and failed.

create or replace function private.guard_business_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (new.plan is distinct from old.plan or new.ai_daily_token_limit is distinct from old.ai_daily_token_limit)
     and not private.can(new.id, 'billing') then
    raise exception 'Only owners change billing' using errcode = '42501';
  end if;
  if (new.pay_period is distinct from old.pay_period or new.pay_period_anchor is distinct from old.pay_period_anchor)
     and not private.can(new.id, 'payroll') then
    raise exception 'Only payroll changes the pay period' using errcode = '42501';
  end if;
  if new.free_text_roles is distinct from old.free_text_roles
     and not private.has_business_role(new.id, array['owner']::public.staff_role[]) then
    raise exception 'Only owners change who can write messages' using errcode = '42501';
  end if;
  if new.next_sale_number < old.next_sale_number then
    raise exception 'Sale numbers only go up' using errcode = '42501';
  end if;
  return new;
end;
$$;
