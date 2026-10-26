-- Two of Denise's scans at the same moment (a no-show starts one while the
-- calendar runs its own) could both find no open proposal for a subject and
-- both insert it, and the second failed the unique rule on open proposals
-- (location, subject, rank). Recording now takes a lock per subject first.
create or replace function private.record_proposals(p_location_id uuid, p_feature text, p_subject text, p_options jsonb, p_staff_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_staff_id uuid;
  v_option jsonb;
  v_rank int := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
begin
  select l.business_id into v_business_id from public.locations l where l.id = p_location_id;
  if v_business_id is null then
    raise exception 'Not allowed to record proposals here' using errcode = '42501';
  end if;
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) > 9 then
    raise exception 'Options must be a list of up to 9' using errcode = '22023';
  end if;
  v_staff_id := p_staff_id;

  if p_subject is not null then
    -- One at a time per subject, so a second scan updates what the first
    -- just wrote instead of inserting the same rank again.
    perform pg_advisory_xact_lock(hashtextextended(p_location_id::text || ':' || p_subject, 0));
    if exists (select 1 from public.ai_actions where location_id = p_location_id and subject = p_subject and status = 'rejected') then
      return v_ids;
    end if;
    delete from public.ai_actions
    where location_id = p_location_id and subject = p_subject and status = 'proposed' and rank > jsonb_array_length(p_options);
  end if;

  for v_option in select * from jsonb_array_elements(p_options) loop
    v_rank := v_rank + 1;
    v_id := null;
    if p_subject is not null then
      update public.ai_actions set
        feature = p_feature,
        summary = v_option ->> 'summary',
        reason = coalesce(v_option ->> 'reason', ''),
        proposal = v_option -> 'proposal'
      where location_id = p_location_id and subject = p_subject and status = 'proposed' and rank = v_rank
      returning id into v_id;
    end if;
    if v_id is null then
      insert into public.ai_actions (business_id, location_id, feature, subject, rank, summary, reason, proposal, proposed_by)
      values (v_business_id, p_location_id, p_feature, p_subject, v_rank, v_option ->> 'summary',
              coalesce(v_option ->> 'reason', ''), v_option -> 'proposal', v_staff_id)
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  return v_ids;
end;
$$;
