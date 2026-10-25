-- A checkout draft's visit, client and sale, and a team member's commission
-- plan, must be the same salon's. They were checked by the functions that
-- write them, but the keys allowed another salon's row; now the database
-- refuses one whatever writes it (as the other salon-owned tables do).

alter table public.appointments add constraint appointments_id_business_id_key unique (id, business_id);

alter table public.sale_drafts
  drop constraint sale_drafts_appointment_id_fkey,
  drop constraint sale_drafts_client_id_fkey,
  drop constraint sale_drafts_sale_id_fkey,
  add constraint sale_drafts_appointment_id_business_id_fkey foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  add constraint sale_drafts_client_id_business_id_fkey foreign key (client_id, business_id) references public.clients (id, business_id) on delete set null (client_id),
  add constraint sale_drafts_sale_id_business_id_fkey foreign key (sale_id, business_id) references public.sales (id, business_id) on delete set null (sale_id);

alter table public.staff_compensation
  drop constraint staff_compensation_plan_id_fkey,
  add constraint staff_compensation_plan_id_business_id_fkey foreign key (plan_id, business_id) references public.commission_plans (id, business_id);
