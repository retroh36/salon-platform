import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { siteUrl } from "@/lib/branding";
import { DEFAULT_ACCENT, slugify } from "@/lib/online-booking/settings";
import { sortCategories } from "@/lib/services";
import { SettingsNav } from "../settings-nav";
import { shareLinks } from "@/lib/online-booking/sources";
import { BookingLink, BookingRulesForm, ServicesOnlineForm, ShareLinks } from "./booking-settings";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Online booking" };

export default function BookingSettingsPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <BookingSettings />
    </Suspense>
  );
}

async function BookingSettings() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");

  const [{ data: business, error }, { data: services, error: serviceError }] = await Promise.all([
    supabase.from("businesses").select("name, slug, online_booking_settings(*)").eq("id", me.business_id).single(),
    supabase.from("services").select("id, name, category, online_booking, deposit_kind, deposit_amount").is("archived_at", null).order("name"),
  ]);
  if (error) throw error;
  if (serviceError) throw serviceError;
  const s = business.online_booking_settings;
  const slug = business.slug ?? slugify(business.name);
  const order = sortCategories(services.map((x) => x.category));
  const sorted = [...services].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Online booking" description="Your salon's own booking site, where clients book themselves in." />
      <SettingsNav current="booking" me={me} />
      <div>
        <Card title="Your booking site" titleId="site-heading" description="Share the link, or put a Book button on your website.">
          <BookingLink url={`${siteUrl()}/book/${slug}`} name={business.name} live={Boolean(s?.enabled && business.slug)} />
        </Card>
        <Card
          title="Booking links for Google and social"
          titleId="share-heading"
          description="Add your booking link where clients find you. Each place gets its own link, so Reports can show where your online bookings come from."
        >
          <ShareLinks links={shareLinks(`${siteUrl()}/book/${slug}`)} />
        </Card>
        <Card title="Rules and look" titleId="rules-heading">
          <BookingRulesForm
            initial={{
              enabled: s?.enabled ?? false,
              slug,
              window_days: String(s?.window_days ?? 60),
              notice_hours: String((s?.notice_minutes ?? 120) / 60),
              allow_new_clients: s?.allow_new_clients ?? true,
              cancel_cutoff_hours: String(s?.cancel_cutoff_hours ?? 24),
              cancellation_policy: s?.cancellation_policy ?? "",
              consultation_service_id: s?.consultation_service_id ?? "",
              accent_color: s?.accent_color ?? DEFAULT_ACCENT,
              welcome: s?.welcome ?? "",
            }}
            services={sorted.map((x) => ({ id: x.id, name: x.name }))}
          />
        </Card>
        <Card flush title="Services online" titleId="services-heading" description="Which services clients can book themselves, which need a consultation first, and any deposit.">
          <ServicesOnlineForm
            services={sorted.map((x) => ({ id: x.id, name: x.name, category: x.category, mode: x.online_booking, depositKind: x.deposit_kind, depositAmount: x.deposit_amount }))}
          />
        </Card>
      </div>
    </AppShell>
  );
}
