import { salonInitial } from "@/lib/branding";

// The booking site's frame: the salon's own brand first (its logo or
// initial, name and color), with "Powered by Maestra" small at the foot.
// --accent is the salon's color (white text on it passes AA, checked when
// it's set); the soft and line shades are mixed from it.
export function BookingFrame({
  name,
  logoUrl,
  accent,
  children,
}: {
  name: string;
  logoUrl: string | null;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-dvh flex-col bg-canvas text-ink"
      style={
        {
          "--accent": accent,
          "--accent-soft": `color-mix(in srgb, ${accent} 8%, white)`,
          "--accent-line": `color-mix(in srgb, ${accent} 40%, white)`,
        } as React.CSSProperties
      }
    >
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" data-testid="salon-logo" className="size-11 shrink-0 rounded-[14px_4px_14px_4px] bg-surface object-contain" />
          ) : (
            <span aria-hidden data-testid="salon-initial" className="inline-flex size-11 shrink-0 items-center justify-center rounded-[14px_4px_14px_4px] bg-(--accent) font-serif text-xl text-white">
              {salonInitial(name)}
            </span>
          )}
          <p className="min-w-0 truncate font-serif text-lg font-semibold tracking-tight text-ink">{name}</p>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-4">{children}</main>
      <footer className="pb-6 text-center text-xs text-ink-subtle">
        <a href="#top" className="sr-only">
          Back to top
        </a>
        <p data-testid="powered-by">Powered by Maestra</p>
      </footer>
    </div>
  );
}
