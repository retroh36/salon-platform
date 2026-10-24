import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/branding";

// Booking sites are for search engines; the app, payment and opt-out links
// and each client's own booking page aren't.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/book/", disallow: ["/", "/book/*/manage/", "/pay/", "/unsubscribe/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
