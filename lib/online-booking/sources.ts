// Where online bookings come from (pure, unit-tested). Each place a salon
// shares its booking link gets its own tagged link (?src=google, …); the
// booking site records the tag on the visit (appointments.online_source),
// so Reports can show where bookings came from. Automated messages tag
// their links too (rebook, win_back, birthday, review).

export const SHARED_SOURCES = ["google", "instagram", "facebook", "website"] as const;
export const MESSAGE_SOURCES = ["rebook", "win_back", "birthday", "review"] as const;
export type BookingSource = (typeof SHARED_SOURCES)[number] | (typeof MESSAGE_SOURCES)[number] | "other" | "direct";

export const SOURCE_LABELS: Record<BookingSource, string> = {
  google: "Google",
  instagram: "Instagram",
  facebook: "Facebook",
  website: "Your website",
  rebook: "Rebook reminders",
  win_back: "Win-back messages",
  birthday: "Birthday messages",
  review: "Review requests",
  other: "Other links",
  direct: "No tag (shared link, typed in)",
};

const KNOWN: readonly string[] = [...SHARED_SOURCES, ...MESSAGE_SOURCES];
// What other tools put in utm_source for the same places.
const ALIASES: Record<string, BookingSource> = { ig: "instagram", "instagram.com": "instagram", fb: "facebook", "facebook.com": "facebook", gbp: "google", "google.com": "google", "google-business": "google", gmb: "google" };

// The source of a visit to the booking site, from ?src= (ours) or
// ?utm_source= (anyone's); untagged visits are "direct".
export function bookingSource(params: { src?: unknown; utm_source?: unknown }): BookingSource {
  const raw = [params.src, params.utm_source].find((v) => typeof v === "string" && v.trim());
  if (typeof raw !== "string") return "direct";
  const value = raw.trim().toLowerCase().slice(0, 40);
  if (KNOWN.includes(value)) return value as BookingSource;
  return ALIASES[value] ?? "other";
}

// A source sent back by the booking page, checked again on the server.
export const isBookingSource = (value: unknown): value is BookingSource => typeof value === "string" && (value === "other" || value === "direct" || KNOWN.includes(value));

export type ShareLink = { source: (typeof SHARED_SOURCES)[number]; label: string; url: string; steps: string[] };

// The ready-to-copy links for Settings, with simple steps for each place.
export function shareLinks(bookingUrl: string): ShareLink[] {
  const url = (source: string) => `${bookingUrl}?src=${source}`;
  return [
    {
      source: "google",
      label: "Google Business Profile",
      url: url("google"),
      steps: [
        "Open your Business Profile (search your salon's name on Google while signed in, or go to business.google.com).",
        "Choose Edit profile, then Booking (sometimes under Contact or More).",
        "Add this link as your booking or appointment link, and save. Google shows a Book button on your listing and in Maps.",
      ],
    },
    {
      source: "instagram",
      label: "Instagram",
      url: url("instagram"),
      steps: [
        "In the Instagram app, go to your profile and tap Edit profile.",
        "Under Action buttons (business and creator accounts), add a Book button with this link; or tap Links and add it to your bio.",
        "Save. Put the link in your stories with a link sticker, too.",
      ],
    },
    {
      source: "facebook",
      label: "Facebook",
      url: url("facebook"),
      steps: [
        "Open your salon's Facebook Page and choose the button under the cover photo (Add action button, or Edit button).",
        "Pick Book now (or Book with you), then Link to website.",
        "Paste this link and save.",
      ],
    },
    {
      source: "website",
      label: "Your website",
      url: url("website"),
      steps: ["Use this link for the Book button on your own website, so those bookings are counted as your website's."],
    },
  ];
}

export type SourceRow = { source: string | null; revenueCents: number; completed: boolean };

// Online bookings in a period by where they came from: how many, how many
// came in (checked out), and what they brought in. Most first.
export function bookingSourcesReport(rows: readonly SourceRow[]) {
  const by = new Map<BookingSource, { bookings: number; completed: number; revenueCents: number }>();
  for (const r of rows) {
    const key: BookingSource = !r.source ? "direct" : isBookingSource(r.source) ? r.source : "other";
    const s = by.get(key) ?? { bookings: 0, completed: 0, revenueCents: 0 };
    s.bookings += 1;
    if (r.completed) s.completed += 1;
    s.revenueCents += r.revenueCents;
    by.set(key, s);
  }
  const sources = [...by.entries()].map(([source, s]) => ({ source, label: SOURCE_LABELS[source], ...s })).sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label));
  return { total: rows.length, sources };
}
