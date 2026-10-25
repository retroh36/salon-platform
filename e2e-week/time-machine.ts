// The simulated week's clock. The app, the database and the browser all
// run on the real clock, so a week can't simply pass. Instead, at the end of
// each simulated day the salon's whole world moves back one day: every date
// and timestamp it has (visits, sales, payments, fees, stock movements, time
// off, pay period anchor…) is a day earlier, and its weekly hours move to
// the weekday before, so what was booked for tomorrow is now today, on
// tomorrow's hours. Only this salon's rows move.
//
// Run as the database superuser (triggers off for the move, since nothing
// here is a change anyone made), in the salon's timezone, so 10am stays 10am.

import { execFileSync } from "node:child_process";

const CONTAINER = "supabase_db_salon-platform";

export function sql(text: string) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"], { input: text, encoding: "utf8" }).trim();
}

// Shifts every date and timestamp of the business by `days` (negative is
// back). In two steps, far into the past and back (checks refuse future
// dates), so unique and exclusion constraints on dates never see two rows
// on the same day mid-move. One update per table moves every date in a row
// at once, since checks compare them (a time off's end after its start).
export function shiftBusiness(businessId: string, timezone: string, days: number, { dryRun = false } = {}) {
  const step = (n: number) => `
    for r in
      select c.table_name,
             string_agg(quote_ident(c.column_name) || ' = ' || quote_ident(c.column_name) || ' + ' ||
                        case when c.data_type = 'date' then '(${n})' else 'interval ''${n} days''' end, ', ') as sets
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.is_generated = 'NEVER'
        and c.data_type in ('date', 'timestamp with time zone')
        and exists (select 1 from information_schema.columns b where b.table_schema = 'public' and b.table_name = c.table_name and b.column_name = 'business_id')
      group by c.table_name
    loop
      execute 'update public.' || quote_ident(r.table_name) || ' set ' || r.sets || ' where business_id = $1' using b;
    end loop;
    update public.businesses set created_at = created_at + interval '${n} days', pay_period_anchor = pay_period_anchor + (${n}) where id = b;
    update public.denise_briefs set day = day + (${n}), created_at = created_at + interval '${n} days'
      where location_id in (select id from public.locations where business_id = b);`;
  sql(`begin;
set local session_replication_role = replica;
set local timezone = '${timezone}';
do $$
declare r record; b uuid := '${businessId}';
begin
  ${step(-10000)}
  ${step(days + 10000)}
  ${turn(days)}
end $$;
${dryRun ? "rollback" : "commit"};`);
}

// Turns the weekly hours (and repeating blocks) by `days`: weekday w gets
// the hours weekday w - days had, 1 = Monday. Out and back in, since a
// person's weekdays can't overlap mid-move. A PL/pgSQL fragment, with the
// business in b.
function turn(days: number) {
  const wd = (col: string) => `((((${col} - 1 + ${days}) % 7) + 7) % 7) + 1`;
  return `
  create temp table moved_hours on commit drop as select * from public.location_hours where business_id = b;
  create temp table moved_shifts on commit drop as select * from public.staff_working_hours where business_id = b;
  update moved_hours set weekday = ${wd("weekday")};
  update moved_shifts set weekday = ${wd("weekday")};
  delete from public.location_hours where business_id = b;
  delete from public.staff_working_hours where business_id = b;
  insert into public.location_hours select * from moved_hours;
  insert into public.staff_working_hours select * from moved_shifts;
  update public.time_blocks set repeat_weekdays = (select array_agg(${wd("w")} order by ${wd("w")}) from unnest(repeat_weekdays) w)
    where business_id = b and repeat_weekdays is not null;`;
}

// Turns only the week (no dates move), so a chosen weekday's hours fall on today.
export function turnWeek(businessId: string, days: number) {
  sql(`begin;
set local session_replication_role = replica;
do $$
declare b uuid := '${businessId}';
begin
  ${turn(days)}
end $$;
commit;`);
}
