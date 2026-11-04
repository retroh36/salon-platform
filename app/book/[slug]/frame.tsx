import { salonInitial } from "@/lib/branding";
import { serif } from "@/app/serif";

// The booking site's frame: the salon's own brand first (its logo or
// initial, name and color), with "Powered by Maestra" small at the foot.
// --accent is the salon's color (white text on it passes AA, checked when
// it's set); the soft and line shades are mixed from it.
// From lg (a laptop, an iPad in landscape) small text is a step bigger
// (13 and 14px read 15px) and secondary text a little darker, for reading
// at a desk; phones keep the usual sizes.
const DESK_TEXT = "lg:[--text-sm:0.9375rem] lg:[--text-13:0.9375rem] lg:[--text-13--line-height:1.375rem] lg:[--color-ink-muted:var(--color-ink-soft)]";

export function BookingFrame({
  name,
  logoUrl,
  accent,
  intro,
  cover,
  wide = false,
  children,
}: {
  name: string;
  logoUrl: string | null;
  accent: string;
  // The booking page's own top (its cover and intro, ./intro.tsx), in place
  // of the bar with the logo and name; the page is wider then.
  intro?: { top: React.ReactNode };
  // The salon's cover photo as a strip across the top, with the logo over
  // its edge (the account and a visit's own page, like the booking site).
  cover?: string | null;
  // Room for two columns from lg (the signed-in account).
  wide?: boolean;
  children: React.ReactNode;
}) {
  const width = wide ? "max-w-5xl md:px-8" : "max-w-xl";
  const mark = (size: string) =>
    logoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" data-testid="salon-logo" className={`${size} shrink-0 rounded-[14px_4px_14px_4px] bg-surface object-contain`} />
    ) : (
      <span aria-hidden data-testid="salon-initial" className={`${size} inline-flex shrink-0 items-center justify-center rounded-[14px_4px_14px_4px] bg-(--accent) font-serif text-xl text-white`}>
        {salonInitial(name)}
      </span>
    );
  return (
    <div
      className={`${serif.variable} ${DESK_TEXT} flex min-h-dvh flex-col bg-canvas text-ink`}
      style={
        {
          "--accent": accent,
          "--accent-soft": `color-mix(in srgb, ${accent} 8%, white)`,
          "--accent-line": `color-mix(in srgb, ${accent} 40%, white)`,
        } as React.CSSProperties
      }
    >
      {intro ? (
        intro.top
      ) : cover ? (
        <header className={`mx-auto w-full md:pt-6 ${wide ? "max-w-5xl md:px-8" : "max-w-xl md:px-4"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" data-testid="salon-cover" className="h-32 w-full bg-sunken object-cover md:h-44 md:rounded-xl" />
          <div className="-mt-7 flex items-end gap-3 px-4 md:-mt-8 md:px-0">
            <span className="shrink-0 rounded-[18px_6px_18px_6px] border-4 border-canvas bg-canvas">{mark("size-14 md:size-16")}</span>
            <p className="min-w-0 truncate pb-1 font-serif text-xl font-semibold text-ink">{name}</p>
          </div>
        </header>
      ) : (
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-3">
            {mark("size-11")}
            <p className="min-w-0 truncate font-serif text-xl font-semibold text-ink">{name}</p>
          </div>
        </header>
      )}
      <main className={`mx-auto flex w-full flex-1 flex-col px-4 pb-4 ${intro ? "max-w-5xl md:px-8" : `${width} pt-6`}`}>{children}</main>
      <footer className="pb-6 text-center text-xs text-ink-subtle">
        <a href="#top" className="sr-only">
          Back to top
        </a>
        <p data-testid="powered-by">Powered by Maestra</p>
      </footer>
    </div>
  );
}
