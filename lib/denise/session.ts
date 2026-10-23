// Who's talking to Denise: the signed-in staff member, their location as
// she sees it, and today there. Shared by her server actions and her
// streaming endpoint (app/api/denise/route.ts).

import { canBook } from "@/lib/appointments";
import { getCurrentStaff } from "@/lib/auth";
import { todayIn } from "@/lib/scheduling/time";
import type { DeniseAsker } from "./day-state";
import type { Viewer } from "./scan";

export async function deniseSession() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return null;
  const viewer: Viewer = {
    location: { id: me.location.id, timezone: me.location.timezone },
    salon: me.location.business?.name ?? "the salon",
    canBook: canBook(me.role),
  };
  return { supabase, me, viewer, today: todayIn(me.location.timezone) };
}

export type DeniseSession = NonNullable<Awaited<ReturnType<typeof deniseSession>>>;

export function askerOf(s: DeniseSession): DeniseAsker {
  return { supabase: s.supabase, role: s.me.role, businessId: s.me.business_id, viewer: s.viewer, today: s.today };
}
