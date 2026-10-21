import { AppFrame, type Section } from "@/components/ui/app-frame";
import type { StaffRole } from "@/lib/staff";

type Me = {
  first_name: string;
  role: StaffRole;
  location: { name: string; business: { name: string } | null };
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
        <h1 className="font-serif text-2xl font-semibold text-plum-900">Not linked to a salon</h1>
        <p className="mt-2 text-sm text-ink-muted">Your account isn&apos;t linked to a salon yet. Ask the salon owner to add you as staff.</p>
      </div>
    </div>
  );
}

// Shown while a page first loads.
export function LoadingShell() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-canvas text-sm text-ink-muted" aria-busy>
      <span className="flex items-center gap-3">
        <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-plum-200 border-t-plum-900" />
        Loading…
      </span>
    </div>
  );
}
