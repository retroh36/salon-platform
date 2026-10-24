import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { canChange, cancelTerms, loadManaged } from "@/lib/online-booking/manage";
import { loadSite } from "@/lib/online-booking/site";
import { toLocal, todayIn } from "@/lib/scheduling/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingFrame } from "../../frame";
import { ManageView } from "./manage-view";

export const metadata: Metadata = { title: { absolute: "Your booking" }, robots: { index: false } };

export default function ManagePage({ params, searchParams }: PageProps<"/book/[slug]/manage/[token]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" aria-busy="true" />}>
      <Manage params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Manage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const [{ slug, token }, query] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const found = await loadSite(admin, slug);
  if (found.status !== "open") notFound();
  const { site } = found;
  const booking = await loadManaged(admin, site, token);
  if (!booking) notFound();
  const tz = site.location.timezone;
  const start = toLocal(booking.start, tz);
  const policy = await cancelTerms(admin, site, booking);

  return (
    <BookingFrame name={site.business.name} logoUrl={site.business.logoUrl} accent={site.settings.accent}>
      <ManageView
        slug={slug}
        token={token}
        justBooked={query.booked === "1"}
        today={todayIn(tz)}
        booking={{
          firstName: booking.clientFirstName,
          status: booking.status,
          date: start.date,
          minute: start.minute,
          endMinute: toLocal(booking.end, tz).minute,
          items: booking.items.map((i) => ({ name: i.serviceName, stylist: i.staffName, priceCents: i.priceCents })),
          depositCents: booking.depositCents,
          depositPaidCents: booking.depositPaidCents,
          canChange: canChange(site, booking),
          cancelFeeCents: policy.feeCents,
          cardLabel: policy.cardLabel,
        }}
        salon={{
          name: site.business.name,
          location: site.location.name,
          address: site.location.address,
          phone: site.location.phone,
          cutoffHours: site.settings.cancelCutoffHours,
          policy: policy.lines,
        }}
      />
    </BookingFrame>
  );
}
