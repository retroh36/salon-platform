import { AppFrame, type Section } from "@/components/ui/app-frame";
import { salonLogoUrl } from "@/lib/branding";
import type { StaffRole } from "@/lib/staff";

type Me = {
  first_name: string;
  role: StaffRole;
  location: { name: string; business: { name: string; logo_path?: string | null } | null };
};

// The app's page layout: the AppFrame sidebar and search bar around the
// page, with the content fading in on arrival. `bleed` gives the page the
// full width and height (the calendar); otherwise content sits in a
// centered column.
export function AppShell({ section, me, bleed = false, children }: { section: Section; me: Me; bleed?: boolean; children: React.ReactNode }) {
  return (
    <AppFrame
      section={section}
      businessName={me.location.business?.name ?? "Salon"}
      logoUrl={salonLogoUrl(me.location.business?.logo_path)}
      locationName={me.location.name}
      user={{ name: me.first_name, role: me.role }}
    >
      {bleed ? children : <div className="mx-auto w-full max-w-5xl animate-fade-in px-4 py-8 sm:px-8">{children}</div>}
    </AppFrame>
  );
}

// Signed in, but not staff at any salon.
export function NotLinked() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-canvas p-6">
      <div className="max-w-sm animate-fade-in rounded-xl border border-line bg-surface p-6 text-center shadow-card">
        <h1 className="font-serif text-2xl font-semibold text-navy-900">Not linked to a salon</h1>
        <p className="mt-2 text-sm text-ink-muted">Your account isn&apos;t linked to a salon yet. Ask the salon owner to add you as staff.</p>
      </div>
    </div>
  );
}

// Shown while a page first loads: the Maestra mark, breathing gently
// (still, with reduced motion).
export function LoadingShell() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-canvas text-sm text-ink-muted" aria-busy>
      <span role="status" className="flex flex-col items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maestra/maestra-mark.svg" alt="" data-testid="loading-mark" className="h-12 w-auto animate-breathe" />
        Loading Maestra…
      </span>
    </div>
  );
}
