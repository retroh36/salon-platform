-- "Find my stylist" on the booking site: a short quiz leading to a suggested
-- service and stylists, worked out by our own rules (lib/stylist-quiz.ts).
-- Anonymous until they book, when it joins the visit, so staff read the
-- answers and photos in booking details. Our rule may flag that the visit
-- needs extra time; staff accept or ignore it. The photos are for the
-- salon's team only: they never go to Denise's AI service.

alter table public.online_booking_settings add column quiz_on boolean not null default false;

create table public.stylist_quizzes (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  answers        jsonb not null,
  service_id     uuid references public.services (id) on delete set null,
  staff_ids      uuid[] not null default '{}',
  photo_paths    text[] not null default '{}' check (cardinality(photo_paths) <= 3),
  flag_minutes   smallint check (flag_minutes between 5 and 120),
  flag_reasons   text[] not null default '{}',
  flag_status    text check (flag_status in ('accepted', 'ignored')),
  flag_by        uuid references public.staff (id) on delete set null,
  flag_at        timestamptz,
  appointment_id uuid references public.appointments (id) on delete set null,
  client_id      uuid references public.clients (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index stylist_quizzes_business on public.stylist_quizzes (business_id, created_at desc);
create index stylist_quizzes_visit on public.stylist_quizzes (appointment_id) where appointment_id is not null;

-- Written by the booking site (service role) and decide_quiz_flag only.
alter table public.stylist_quizzes enable row level security;
create policy stylist_quizzes_read on public.stylist_quizzes for select to authenticated
  using (business_id in (select private.front_of_house_businesses()) or appointment_id in (select private.my_book_visits()));

create function public.decide_quiz_flag(p_quiz_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quiz public.stylist_quizzes;
begin
  select * into v_quiz from public.stylist_quizzes where id = p_quiz_id for update;
  if v_quiz.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.front_of_house(v_quiz.business_id) then
    raise exception 'Only the front of house decides this' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'ignored') or v_quiz.flag_minutes is null then
    raise exception 'Nothing to decide' using errcode = '22023';
  end if;
  if v_quiz.flag_status is not null then
    raise exception 'Already decided' using errcode = '22023', hint = 'decided';
  end if;
  update public.stylist_quizzes
  set flag_status = p_decision, flag_by = private.current_staff_id(v_quiz.business_id), flag_at = now()
  where id = p_quiz_id;
end;
$$;
revoke all on function public.decide_quiz_flag(uuid, text) from public, anon;
grant execute on function public.decide_quiz_flag(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-photos', 'quiz-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy quiz_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'quiz-photos' and (
    (select private.front_of_house(private.logo_business(name)))
    or exists (select 1 from public.stylist_quizzes q where name = any (q.photo_paths) and q.appointment_id in (select private.my_book_visits()))
  ));
