import type { Metadata } from "next";
import { TAGLINE } from "@/lib/branding";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// Maestra's own screen (the product brand, not a salon's): the logo and
// tagline beside a plain sign-in form. On narrow screens the panel folds
// to the logo above the form.
export default function LoginPage() {
  return (
    <main className="flex flex-1 bg-canvas">
      <section
        aria-label="Maestra"
        className="relative hidden w-[44%] max-w-2xl shrink-0 flex-col justify-between overflow-hidden bg-navy-900 px-14 py-12 text-white lg:flex"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maestra/maestra-logo-white.png" alt="Maestra" className="-ml-3 h-16 w-auto self-start" />
        <div className="relative z-10 animate-fade-in">
          <p className="font-serif text-5xl leading-[1.05] font-semibold tracking-tight">Your salon&rsquo;s brain.</p>
          <p className="mt-5 flex items-center gap-3 text-2xl font-semibold text-denise-200">
            <span className="inline-flex size-11 overflow-hidden rounded-full bg-denise-100 ring-2 ring-denise-500">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/denise/face.png" alt="" className="size-full object-cover" />
            </span>
            Meet Denise.
          </p>
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
            <p className="mt-3 text-ink-muted">{TAGLINE}</p>
          </div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-navy-900">Sign in</h1>
          <p className="mt-1 mb-8 text-ink-muted">Welcome back. Sign in to your salon.</p>
          <LoginForm />
          <p className="mt-10 text-xs text-ink-subtle">Trouble signing in? Ask your salon&rsquo;s owner to check your account.</p>
        </div>
      </div>
    </main>
  );
}
