import { AppFrame, type Section } from "@/components/ui/app-frame";
import { canBook } from "@/lib/appointments";
import { salonLogoUrl } from "@/lib/branding";
import { todayIn } from "@/lib/scheduling/time";
import { deviceTokenHash } from "@/lib/shared-device";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/staff";

type Me = {
  id: string;
  first_name: string;
  business_id: string;
  role: StaffRole;
  permissions: readonly string[];
  location: { id?: string; name: string; timezone: string; business: { name: string; logo_path?: string | null; auto_lock_minutes?: number } | null };
};

// The app's page layout: the AppFrame sidebar and search bar around the
// page, with the content fading in on arrival, and Denise's bubble in the
// corner. `bleed` gives the page the full width and height (the calendar);
// otherwise content sits in a centered column (`wide`: a little wider, for
// the Dashboard), with room at the foot so her bubble never sits on the
// last thing on the page. `denise={false}`: the page has her already (the
// calendar's side panel).
export async function AppShell({
  section,
  me,
  bleed = false,
  wide = false,
  denise = true,
  children,
}: {
  section: Section;
  me: Me;
  bleed?: boolean;
  wide?: boolean;
  denise?: boolean;
  children: React.ReactNode;
}) {
  // On the shared iPad: Switch user, and lock when idle.
  const shared = (await deviceTokenHash()) ? { autoLockMinutes: me.location.business?.auto_lock_minutes ?? 5 } : null;
  // The salon's locations, for the sidebar's salon card.
  const { data: locations } = await (await createClient()).from("locations").select("id, name, city, region").eq("business_id", me.business_id).order("name");
  return (
    <AppFrame
      sharedDevice={shared}
      section={section}
      businessName={me.location.business?.name ?? "Salon"}
      logoUrl={salonLogoUrl(me.location.business?.logo_path)}
      locationName={me.location.name}
      locationId={me.location.id}
      locations={locations ?? []}
      user={{ name: me.first_name, role: me.role, permissions: me.permissions }}
      denise={denise ? { staffId: me.id, firstName: me.first_name, canBook: canBook(me.role), today: todayIn(me.location.timezone) } : null}
    >
      {bleed ? children : <div className={`mx-auto w-full animate-fade-in px-4 pt-8 pb-24 sm:px-8 ${wide ? "max-w-6xl" : "max-w-5xl"}`}>{children}</div>}
    </AppFrame>
  );
}

// Signed in, but not staff at any salon.
export function NotLinked() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-canvas p-6">
      <div className="max-w-sm animate-fade-in rounded-lg border border-line bg-surface p-6 text-center">
        <h1 className="text-2xl font-semibold text-ink">Not linked to a salon</h1>
        <p className="mt-2 text-sm text-ink-muted">Your account isn&apos;t linked to a salon yet. Ask the salon owner to add you as staff.</p>
      </div>
    </div>
  );
}

// Shown while a page first loads: Maestra's logo, breathing gently (still,
// with reduced motion).
export function LoadingShell() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-canvas text-sm text-ink-muted" aria-busy>
      <span role="status" className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maestra/maestra-logo.png" alt="" data-testid="loading-logo" className="h-10 w-auto animate-breathe" />
        Loading Maestra…
      </span>
    </div>
  );
}
