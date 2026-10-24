import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/branding";
import { createAdminClient } from "@/lib/supabase/admin";

// Search engines get the salons' booking sites (where online booking is
// on); everything else is the private app.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data, error } = await createAdminClient().from("businesses").select("slug, online_booking_settings!inner(enabled, updated_at)").eq("online_booking_settings.enabled", true).not("slug", "is", null);
  if (error) throw error;
  return data.map((b) => ({ url: `${siteUrl()}/book/${b.slug}`, lastModified: b.online_booking_settings!.updated_at, changeFrequency: "weekly", priority: 1 }));
}
