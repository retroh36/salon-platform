import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/page";
import { getCurrentStaff } from "@/lib/auth";
import { salonLogoUrl, staffPhotoUrl } from "@/lib/branding";
import { slugify } from "@/lib/online-booking/settings";
import { can } from "@/lib/permissions";
import { sortCategories } from "@/lib/services";
import { SettingsNav } from "../settings-nav";
import { CategoryPhoto, CoverForm, ServiceDescriptionsForm, StylistProfileForm } from "./booking-page-forms";

export const metadata: Metadata = { title: "Booking page" };

export default function BookingPageSettings() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <BookingPage />
    </Suspense>
  );
}

// What clients see on the booking site: the cover photo and description,
// each stylist's portrait, specialty, bio and work, and the menu's
// descriptions and category photos.
async function BookingPage() {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (!can(me, "settings")) redirect("/dashboard");

  const [business, stylists, services, photos] = await Promise.all([
    supabase.from("businesses").select("name, slug, online_booking_settings(welcome, cover_path)").eq("id", me.business_id).single(),
    supabase
      .from("staff")
      .select("id, first_name, last_name, level, color, photo_path, specialty, bio, portfolio_paths")
      .eq("location_id", me.location.id)
      .eq("role", "stylist")
      .eq("is_active", true)
      .order("first_name"),
    supabase.from("services").select("id, name, category, description").is("archived_at", null).neq("online_booking", "off").order("name"),
    supabase.from("service_category_photos").select("category, photo_path"),
  ]);
  for (const r of [business, stylists, services, photos]) if (r.error) throw r.error;
  const settings = business.data!.online_booking_settings;
  const slug = business.data!.slug ?? slugify(business.data!.name);
  const order = sortCategories(services.data!.map((s) => s.category));
  const categories = order.filter((c) => services.data!.some((s) => s.category === c));
  const photoOf = new Map(photos.data!.map((p) => [p.category, salonLogoUrl(p.photo_path)]));
  const manageTeam = can(me, "team");

  return (
    <AppShell section="settings" me={me}>
      <PageHeader
        title="Booking page"
        description="How your salon looks to clients booking online."
        actions={
          <a href={`/book/${slug}`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
            View booking page
          </a>
        }
      />
      <SettingsNav current="booking-page" me={me} />
      <Card title="Cover and description" titleId="cover-heading">
        <CoverForm coverUrl={salonLogoUrl(settings?.cover_path)} description={settings?.welcome ?? ""} />
      </Card>
      <Card
        title="Stylists"
        titleId="stylists-heading"
        description={
          manageTeam
            ? "A portrait, one line on what each stylist does best, and a few photos of their work. Without a portrait, their initials show."
            : "Only owners, and managers who manage the team, can change stylists' profiles."
        }
      >
        <ul className="-my-5">
          {stylists.data!.map((s) => (
            <StylistProfileForm
              key={s.id}
              stylist={{
                id: s.id,
                name: [s.first_name, s.last_name].filter(Boolean).join(" "),
                firstName: s.first_name,
                level: s.level,
                color: s.color,
                photoUrl: staffPhotoUrl(s.photo_path),
                specialty: s.specialty ?? "",
                bio: s.bio ?? "",
                portfolio: s.portfolio_paths.map((path) => ({ path, url: staffPhotoUrl(path)! })),
              }}
            />
          ))}
        </ul>
      </Card>
      <Card title="Category photos" titleId="categories-heading" description="An optional photo above each part of your menu.">
        <ul className="grid gap-5 sm:grid-cols-2">
          {categories.map((c) => (
            <li key={c} className="flex flex-col gap-2">
              <h3 className="text-13 font-medium text-ink">{c}</h3>
              <CategoryPhoto category={c} url={photoOf.get(c) ?? null} />
            </li>
          ))}
        </ul>
      </Card>
      <Card
        title="Service descriptions"
        titleId="descriptions-heading"
        description={
          <>
            A short line under each service online. Services not booked online aren&rsquo;t listed; that&rsquo;s set on{" "}
            <Link href="/settings/booking" className="font-medium text-link underline underline-offset-2">
              Online booking
            </Link>
            .
          </>
        }
      >
        <ServiceDescriptionsForm
          services={categories.flatMap((c) =>
            services.data!.filter((s) => s.category === c).map((s) => ({ id: s.id, name: s.name, category: s.category, description: s.description ?? "" })),
          )}
        />
      </Card>
    </AppShell>
  );
}
