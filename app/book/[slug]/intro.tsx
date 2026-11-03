import Link from "next/link";
import { ClockIcon, MapPinIcon, PhoneIcon } from "@/components/ui/icons";
import { salonInitial } from "@/lib/branding";
import { hoursRows, mapLink, todayLine } from "@/lib/online-booking/intro";
import type { BookingSite } from "@/lib/online-booking/site";
import { accentLink, primaryButton, secondaryButton } from "./styles";

// The top of the page: the client's links on the right (an event inquiry,
// their account), then the cover photo across the top when there is one.
export function SalonTop({ coverUrl, account, eventsLink }: { coverUrl: string | null; account: { href: string; label: string }; eventsLink: string | null }) {
  return (
    <>
      <nav aria-label="Your visit" className="mx-auto flex w-full max-w-5xl flex-wrap justify-end gap-x-5 gap-y-1 px-4 py-3 text-sm md:px-8" data-testid="site-links">
        {eventsLink && (
          <Link href={eventsLink} className={accentLink}>
            Weddings and events
          </Link>
        )}
        <Link href={account.href} className={accentLink}>
          {account.label}
        </Link>
      </nav>
      {coverUrl && (
        <div className="mx-auto w-full max-w-5xl md:px-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverUrl} alt="" data-testid="salon-cover" className="aspect-[16/10] max-h-80 w-full bg-sunken object-cover md:aspect-[3/1] md:rounded-xl" />
        </div>
      )}
    </>
  );
}

// The top of the booking site: the salon's cover photo, logo and name, its
// short description, where and when, and Book now. A client signed in with a
// past visit gets "Book again" first, one tap from booking it. No reviews
// yet: they'll go under the description once there are real ones.
export function SalonIntro({
  site,
  weekday,
  rebook,
}: {
  site: BookingSite;
  // The salon's day of the week today (ISO, 1 = Monday).
  weekday: number;
  rebook: { href: string; label: string; firstName: string } | null;
}) {
  const { business, location, settings } = site;
  const rows = hoursRows(location.hours);
  return (
    // Over the cover's bottom edge when there is one; the whole column moves
    // up, so it sticks with the logo in view.
    <header data-testid="salon-intro" className={`lg:sticky lg:top-6 lg:self-start ${business.coverUrl ? "-mt-9 md:-mt-11" : "pt-2"}`}>
      <div>
        <div className="flex items-end gap-4">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logoUrl}
              alt=""
              data-testid="salon-logo"
              className="size-18 shrink-0 rounded-[18px_6px_18px_6px] border-4 border-canvas bg-surface object-contain md:size-22"
            />
          ) : (
            <span
              aria-hidden
              data-testid="salon-initial"
              className="inline-flex size-18 shrink-0 items-center justify-center rounded-[18px_6px_18px_6px] border-4 border-canvas bg-(--accent) text-3xl text-white md:size-22"
            >
              {salonInitial(business.name)}
            </span>
          )}
        </div>

        <h1 className="mt-4 text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-balance text-ink md:text-[2rem]">{business.name}</h1>

        {rebook && (
          <div className="mt-5 rounded-lg border border-(--accent-line) bg-(--accent-soft) p-4" data-testid="book-again">
            <p className="text-sm text-ink-muted">Welcome back, {rebook.firstName}</p>
            <p className="mt-0.5 font-medium text-ink">{rebook.label}</p>
            <Link href={rebook.href} className={`${primaryButton} mt-3`}>
              Book again
            </Link>
          </div>
        )}

        {settings.welcome && <p className="mt-3 max-w-prose text-base leading-relaxed text-pretty text-ink-muted">{settings.welcome}</p>}

        <ul className="mt-5 flex flex-col gap-3 text-sm text-ink">
          {location.address && (
            <li className="flex gap-3">
              <MapPinIcon className="mt-px size-5 text-ink-muted" />
              <span>
                {location.address}
                <a href={mapLink(business.name, location.address)} target="_blank" rel="noreferrer" className={`${accentLink} ml-2 whitespace-nowrap`}>
                  Map
                </a>
              </span>
            </li>
          )}
          {location.phone && (
            <li className="flex gap-3">
              <PhoneIcon className="mt-px size-5 text-ink-muted" />
              <a href={`tel:${location.phone.replace(/[^\d+]/g, "")}`} className={accentLink}>
                {location.phone}
              </a>
            </li>
          )}
          {location.hours.length > 0 && (
            <li className="flex gap-3">
              <ClockIcon className="mt-px size-5 text-ink-muted" />
              <details className="group min-w-0 flex-1">
                <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                  {todayLine(location.hours, weekday)} <span className={`${accentLink} ml-1`}>All hours</span>
                </summary>
                <dl className="mt-2 grid max-w-64 grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-ink-muted" data-testid="salon-hours">
                  {rows.map((r) => (
                    <div key={r.days} className="contents">
                      <dt>{r.days}</dt>
                      <dd className="tabular-nums">{r.hours}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          )}
        </ul>

        <a href="#book" className={`${rebook ? secondaryButton : primaryButton} mt-6 w-full lg:hidden`}>
          {rebook ? "Book something else" : "Book now"}
        </a>
      </div>
    </header>
  );
}
