-- Appointment reminders: a message in fixed words to each client a set time
-- before their visit (businesses.reminders_on, reminder_hours: Settings →
-- Messages, the settings permission, like the other columns there), on the
-- channel they allow for messages about their visits. Each is recorded once
-- per visit and start time (appointment_reminders: a visit moved later gets
-- one for its new time) and put in the outbox like every message, which
-- holds it until the salon goes live with texts and email
-- (…_going_live.sql). Sent by /api/cron/reminders every 15 minutes, within
-- each salon's 9am-8pm (lib/reminders-run.ts).

alter table public.businesses
  add column reminders_on boolean not null default true,
  add column reminder_hours integer not null default 24
    constraint businesses_reminder_hours_check check (reminder_hours in (2, 4, 12, 24, 48, 72));

create table public.appointment_reminders (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  starts_at      timestamptz not null,
  channel        text not null check (channel in ('sms', 'email')),
  outbox_id      uuid references public.outbox_messages (id) on delete set null,
  -- Kept in the outbox because the salon isn't live yet: it never goes later.
  held           boolean not null default false,
  sent_at        timestamptz not null default now(),
  unique (appointment_id, starts_at)
);

create index appointment_reminders_business on public.appointment_reminders (business_id, sent_at desc);

-- The front of house read them (booking details' History); only the
-- service role writes them.
alter table public.appointment_reminders enable row level security;
create policy "front of house read reminders" on public.appointment_reminders
  for select to authenticated
  using (business_id in (select private.front_of_house_businesses()));

-- Every 15 minutes.
select cron.schedule('maestra-reminders', '*/15 * * * *', $$select private.run_scheduled_job('/api/cron/reminders')$$);
