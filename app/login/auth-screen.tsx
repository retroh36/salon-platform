import { DenisePose } from "@/components/denise";
import { ForgetDenise } from "@/components/denise-chat/forget";
import { TAGLINE } from "@/lib/branding";
import { serif } from "@/app/serif";

// Maestra's own screen (the product brand, not a salon's): the logo and
// tagline beside a plain form (signing in, a forgotten password, choosing a
// password). On narrow screens the panel folds to the logo above the form.
export function AuthScreen({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className={`${serif.variable} flex flex-1 bg-canvas`}>
      <ForgetDenise />
      <section
        aria-label="Maestra"
        className="relative hidden w-[44%] max-w-2xl shrink-0 flex-col justify-between overflow-hidden bg-navy-900 px-14 py-12 text-white lg:flex"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maestra/maestra-logo-white.png" alt="Maestra" className="-ml-3 h-16 w-auto self-start" />
        <div className="relative z-10 animate-fade-in">
          <p className="font-serif text-display-lg font-semibold tracking-[-0.01em]">Your salon&rsquo;s brain.</p>
          <div className="mt-5 flex items-center gap-4 font-serif text-display-lg font-semibold text-denise-200">
            {/* Her full illustration, on a light tile: her outline is the
                panel's navy. */}
            <span className="flex size-24 shrink-0 items-center justify-center rounded-2xl bg-denise-50">
              <DenisePose className="w-18" />
            </span>
            Meet Denise.
          </div>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-navy-100/80">
            The calendar, clients, stock and the back office in one place, with Denise spotting problems and lining up fixes for your team.
          </p>
        </div>
        <p className="text-sm text-navy-100/70">Maestra · the master who conducts the whole salon</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maestra/maestra-mark-white.svg" alt="" aria-hidden className="pointer-events-none absolute -right-24 -bottom-16 h-[26rem] w-auto opacity-[0.06]" />
      </section>

      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-10 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/maestra/maestra-logo.png" alt="Maestra" className="-ml-2 h-12 w-auto" />
            <p className="mt-3 text-sm text-ink-muted">{TAGLINE}</p>
          </div>
          <h1 className="font-serif text-2xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          <p className="mt-1 mb-8 text-ink-muted">{subtitle}</p>
          {children}
          {footer}
        </div>
      </div>
    </main>
  );
}
