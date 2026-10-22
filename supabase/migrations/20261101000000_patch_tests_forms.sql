-- Patch tests and consultation forms.
--
-- Some services (color, lightener, toner by default) need a patch test: a
-- skin test for allergic reaction, done at least patch_test_min_hours
-- before the service and valid for patch_test_valid_days. The salon decides
-- whether a missing, expired or too-recent test is a warning or blocks the
-- booking (lib/patch-tests.ts; enforced in lib/scheduling/book.ts).
--
-- Owners build form templates (text, checkboxes, yes/no, signature), which
-- can be required before a client's first visit or before some services.
-- Clients fill and sign them on the front desk's iPad; each signed form is
-- kept on the client's record with a copy of the template as it was.

alter table public.businesses
  add column patch_test_valid_days smallint not null default 182 check (patch_test_valid_days between 1 and 1095),
  add column patch_test_min_hours smallint not null default 48 check (patch_test_min_hours between 0 and 336),
  add column patch_test_enforcement text not null default 'warn' check (patch_test_enforcement in ('warn', 'block'));

alter table public.services add column requires_patch_test boolean not null default false;

update public.services set requires_patch_test = true
where category ~* '(colou?r|highlight|balayage|lighten|bleach)' or name ~* '(colou?r|gloss|toner|lighten|bleach|highlight|balayage)';

create type public.patch_test_result as enum ('no_reaction', 'reaction');

create table public.client_patch_tests (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  client_id     uuid not null,
  tested_at     timestamptz not null,
  products      text not null check (length(trim(products)) > 0 and length(products) <= 500),
  result        public.patch_test_result not null,
  performed_by  uuid not null,
  notes         text check (length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (performed_by, business_id) references public.staff (id, business_id)
);

create index client_patch_tests_client_idx on public.client_patch_tests (client_id, tested_at desc);
create index client_patch_tests_business_id_idx on public.client_patch_tests (business_id);

create type public.form_requirement as enum ('none', 'first_visit', 'services');

create table public.form_templates (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0 and length(name) <= 120),
  intro        text check (length(intro) <= 2000),
  -- [{"id", "type": "text" | "checkbox" | "yes_no" | "signature", "label", "required"}]
  fields       jsonb not null check (jsonb_typeof(fields) = 'array'),
  required     public.form_requirement not null default 'none',
  service_ids  uuid[] not null default '{}',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (required <> 'services' or cardinality(service_ids) > 0),
  unique (id, business_id)
);

create unique index form_templates_business_name_key on public.form_templates (business_id, lower(trim(name)));

create table public.client_forms (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  client_id       uuid not null,
  template_id     uuid,
  -- The template as it was when signed.
  template_name   text not null,
  fields          jsonb not null,
  answers         jsonb not null,
  -- A PNG data URL of the client's signature.
  signature       text check (signature ~ '^data:image/png;base64,' and length(signature) <= 400000),
  signed_at       timestamptz not null default now(),
  collected_by    uuid,
  foreign key (client_id, business_id) references public.clients (id, business_id) on delete cascade,
  foreign key (template_id, business_id) references public.form_templates (id, business_id) on delete set null (template_id),
  foreign key (collected_by, business_id) references public.staff (id, business_id) on delete set null (collected_by)
);

create index client_forms_client_idx on public.client_forms (client_id, signed_at desc);
create index client_forms_template_idx on public.client_forms (template_id);
create index client_forms_business_id_idx on public.client_forms (business_id);

create trigger form_templates_set_updated_at before update on public.form_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Patch tests: everyone sees them; any staff member records one (done by
-- any staff member). Append-only, like formulas.
-- Templates: everyone sees them; owners build them.
-- Signed forms: everyone sees them; any staff member collects one, as
-- themselves. Append-only: a correction is a new signed form.
-- ---------------------------------------------------------------------------

alter table public.client_patch_tests enable row level security;
alter table public.form_templates enable row level security;
alter table public.client_forms enable row level security;

create policy "Members can view patch tests"
  on public.client_patch_tests for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can record patch tests"
  on public.client_patch_tests for insert to authenticated
  with check ((select private.is_business_member(business_id)));

create policy "Members can view form templates"
  on public.form_templates for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Owners can manage form templates"
  on public.form_templates for all to authenticated
  using ((select private.has_business_role(business_id, array['owner']::public.staff_role[])))
  with check ((select private.has_business_role(business_id, array['owner']::public.staff_role[])));

create policy "Members can view signed forms"
  on public.client_forms for select to authenticated
  using ((select private.is_business_member(business_id)));
create policy "Members can collect signed forms"
  on public.client_forms for insert to authenticated
  with check ((select private.is_current_staff(business_id, collected_by)));
