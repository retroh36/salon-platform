import Link from "next/link";
import { Card, nameLinkClass } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMinute, todayIn } from "@/lib/scheduling/time";
import { clockOn, dueReminders } from "@/lib/time-clock-load";

// For those who manage the team, where the salon uses the time clock: who
// hasn't clocked in 10 minutes into their shift, and who's still clocked
// in 10 minutes after it ended (the same people the reminders go to).
// Nobody, nothing shown.
export async function ClockNotices() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me || !can(me, "team") || !(await clockOn(supabase, me.business_id))) return null;
  const due = await dueReminders(supabase, me.location, new Date());
  if (!due.length) return null;
  const month = todayIn(me.location.timezone).slice(0, 7);
  return (
    <Card title="Time clock" titleId="clock-notices-heading" description="They've had a reminder in the app. Fix their hours on their month in Scheduling." data-testid="clock-notices" flush>
      <ul className="divide-y divide-line text-sm" aria-label="Not clocked in or out">
        {due.map((r) => (
          <li key={`${r.staffId}:${r.kind}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3" data-kind={r.kind}>
            <Link href={`/scheduling/month?month=${month}&staff=${r.staffId}`} className={nameLinkClass}>
              {r.firstName}
            </Link>
            <span className="text-13 text-ink-muted">{r.kind === "in" ? `Not clocked in · shift started ${formatMinute(r.shiftStart)}` : `Still clocked in · shift ended ${formatMinute(r.shiftEnd)}`}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
