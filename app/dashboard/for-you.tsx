import { getCurrentStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/schedule-format";
import { formatMinute, toLocal } from "@/lib/scheduling/time";
import { ForYouList } from "./for-you-list";

// Notices for the signed-in person in the app (front of house): alerts
// about voids, refunds, $0 sales, gift card changes and waived fees for
// those with the audit permission, and time-off and shift swap requests to
// decide, until they tap Got it. Nothing unread, nothing shown.
export async function ForYou({ meId, timeZone }: { meId: string; timeZone: string }) {
  const { supabase, staff: me } = await getCurrentStaff();
  const { data } = await supabase
    .from("notifications")
    .select("id, body, created_at")
    .eq("staff_id", meId)
    .eq("channel", "app")
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (!data?.length) return null;
  const when = (iso: string) => {
    const local = toLocal(new Date(iso), timeZone);
    return `${formatDay(local.date)}, ${formatMinute(local.minute)}`;
  };
  return <ForYouList notices={data.map((n) => ({ id: n.id, body: n.body, when: when(n.created_at) }))} audit={can(me, "audit")} />;
}
