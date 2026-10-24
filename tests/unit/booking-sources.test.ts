import { describe, expect, it } from "vitest";
import { jsonLdText, seoFor, type SeoInfo } from "@/lib/online-booking/seo";
import { bookingSource, bookingSourcesReport, isBookingSource, shareLinks } from "@/lib/online-booking/sources";

describe("where a booking came from", () => {
  it("reads our tag, or another tool's utm_source, and calls the rest other or direct", () => {
    expect(bookingSource({ src: "google" })).toBe("google");
    expect(bookingSource({ src: " Instagram " })).toBe("instagram");
    expect(bookingSource({ utm_source: "fb" })).toBe("facebook");
    expect(bookingSource({ utm_source: "gbp" })).toBe("google");
    expect(bookingSource({ src: "rebook" })).toBe("rebook");
    expect(bookingSource({ src: "tiktok" })).toBe("other");
    expect(bookingSource({ src: ["google"] })).toBe("direct");
    expect(bookingSource({})).toBe("direct");
    expect(isBookingSource("website")).toBe(true);
    expect(isBookingSource("'; drop table")).toBe(false);
  });

  it("gives each place its own link, with steps", () => {
    const links = shareLinks("https://app.test/book/maple");
    expect(links.map((l) => [l.label, l.url])).toEqual([
      ["Google Business Profile", "https://app.test/book/maple?src=google"],
      ["Instagram", "https://app.test/book/maple?src=instagram"],
      ["Facebook", "https://app.test/book/maple?src=facebook"],
      ["Your website", "https://app.test/book/maple?src=website"],
    ]);
    expect(links.every((l) => l.steps.length > 0)).toBe(true);
  });

  it("reports bookings, visits that came in and revenue by source, most first", () => {
    const r = bookingSourcesReport([
      { source: "google", completed: true, revenueCents: 9000 },
      { source: "google", completed: false, revenueCents: 0 },
      { source: "instagram", completed: true, revenueCents: 5000 },
      { source: null, completed: true, revenueCents: 4000 },
      { source: "nonsense", completed: false, revenueCents: 0 },
    ]);
    expect(r.total).toBe(5);
    // Most first, then by name.
    expect(r.sources).toEqual([
      { source: "google", label: "Google", bookings: 2, completed: 1, revenueCents: 9000 },
      { source: "instagram", label: "Instagram", bookings: 1, completed: 1, revenueCents: 5000 },
      { source: "direct", label: "No tag (shared link, typed in)", bookings: 1, completed: 1, revenueCents: 4000 },
      { source: "other", label: "Other links", bookings: 1, completed: 0, revenueCents: 0 },
    ]);
  });
});

describe("how the booking site shows up in Google", () => {
  const info: SeoInfo = {
    name: "Maple & Ash Hair Studio",
    slug: "maple-and-ash",
    logoUrl: "https://cdn.test/logo.png",
    welcome: null,
    address: { line1: "1428 N Milwaukee Ave", line2: null, city: "Chicago", region: "IL", postalCode: "60622", country: "US" },
    phone: "(312) 555-0100",
    hours: [
      { weekday: 6, start: 480, end: 1020 },
      { weekday: 2, start: 540, end: 1140 },
    ],
    services: [
      { name: "Women's Cut & Style", category: "Cuts", fromCents: 8500 },
      { name: "Balayage", category: "Color", fromCents: 25000 },
      { name: "Blowout", category: "Blowouts & Styling", fromCents: 5500 },
    ],
  };

  it("has a title and description from the salon's own details", () => {
    const s = seoFor(info, "https://app.test");
    expect(s.url).toBe("https://app.test/book/maple-and-ash");
    expect(s.title).toBe("Book online at Maple & Ash Hair Studio · Chicago, IL");
    expect(s.description).toBe("Book cuts, color and blowouts & styling at Maple & Ash Hair Studio in Chicago, IL. Choose your service, stylist and time online, any time.");
    expect(seoFor({ ...info, welcome: "Chicago's friendliest color studio" }, "https://app.test").description).toBe(
      "Chicago's friendliest color studio. Book cuts, color and blowouts & styling at Maple & Ash Hair Studio in Chicago, IL. Choose your service, stylist and time online, any time.",
    );
  });

  it("describes the salon as a HairSalon: address, hours, prices, services and a Book action", () => {
    const { jsonLd } = seoFor(info, "https://app.test");
    expect(jsonLd).toMatchObject({
      "@type": "HairSalon",
      name: "Maple & Ash Hair Studio",
      telephone: "(312) 555-0100",
      address: { "@type": "PostalAddress", streetAddress: "1428 N Milwaukee Ave", addressLocality: "Chicago", addressRegion: "IL", postalCode: "60622", addressCountry: "US" },
      openingHoursSpecification: [
        { dayOfWeek: "https://schema.org/Tuesday", opens: "09:00", closes: "19:00" },
        { dayOfWeek: "https://schema.org/Saturday", opens: "08:00", closes: "17:00" },
      ],
      priceRange: "$55–$250",
      potentialAction: { "@type": "ReserveAction", target: { urlTemplate: "https://app.test/book/maple-and-ash" } },
    });
    expect(jsonLd.hasOfferCatalog!.itemListElement[0]).toEqual({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: "Women's Cut & Style", category: "Cuts" },
      priceSpecification: { "@type": "PriceSpecification", minPrice: "85.00", priceCurrency: "USD" },
    });
  });

  it("can't be broken out of its script tag", () => {
    expect(jsonLdText({ name: "</script><script>alert(1)</script>" })).toBe('{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}');
  });
});
