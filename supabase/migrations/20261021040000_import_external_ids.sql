-- Which of our rows came from which record in another system (e.g. Phorest),
-- so re-running an import updates rows instead of duplicating them.
--
-- Written and read only by trusted server-side import jobs (service role):
-- RLS is on with no policies, so the API exposes nothing.

create table public.import_external_ids (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  source       text not null check (source in ('phorest')),
  entity       text not null,
  external_id  text not null,
  internal_id  uuid not null,
  imported_at  timestamptz not null default now(),
  primary key (business_id, source, entity, external_id)
);

create index import_external_ids_internal_id_idx on public.import_external_ids (internal_id);

alter table public.import_external_ids enable row level security;
