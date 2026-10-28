"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { browserClient } from "@/lib/supabase/client";

// Several changes in one save (a published week moves the version more than
// once) come as one.
const SETTLE_MS = 300;

// Calls `onChange` whenever the location's calendar changes elsewhere: a
// booking, a status, a published week, approved time off or a swap (each
// moves `locations.calendar_version`, which Supabase Realtime sends to the
// salon's own signed-in staff within a second or two), and whenever the tab
// comes back into view or gets focus, in case the connection dropped. Pages
// check their own stamp before reloading.
export function useCalendarChanges(locationId: string, onChange: () => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), SETTLE_MS);
    };
    const supabase = browserClient();
    const channel = supabase
      .channel(`calendar:${locationId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "locations", filter: `id=eq.${locationId}` }, fire);
    // Joined as the signed-in person (the token comes from the server), so
    // RLS lets the change through.
    let stopped = false;
    void supabase.realtime.setAuth().then(() => {
      if (!stopped) channel.subscribe();
    });
    const back = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", fire);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", fire);
      void supabase.removeChannel(channel);
    };
  }, [locationId]);
}

// For pages without a stamp of their own (My day, the published schedule):
// loads the page again when the calendar changes.
export function LiveRefresh({ locationId }: { locationId: string }) {
  const router = useRouter();
  useCalendarChanges(locationId, () => router.refresh());
  return null;
}
