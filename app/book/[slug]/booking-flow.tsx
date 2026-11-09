"use client";

import { levelTitle } from "@/lib/levels";
import { CardField, type CardFieldHandle } from "@/components/card-field";
import { DemoCode } from "@/components/demo-bar";
import { APPOINTMENT_TEXTS_CONSENT, MARKETING_CONSENT } from "@/lib/messaging/consent";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { ChevronDownIcon } from "@/components/ui/icons";
import { LevelBadge, useLevels } from "@/components/ui/level";
import { fromPrice, stepLabel } from "@/lib/online-booking/intro";
import { Alert } from "@/components/ui/page";
import type { BookingSite, SiteService, SiteStylist } from "@/lib/online-booking/site";
import { describeDeposit } from "@/lib/online-booking/settings";
import type { BookingSource } from "@/lib/online-booking/sources";
import { formatMinute, toLocal, type LocalDate } from "@/lib/scheduling/time";
import { formatPrice, formatPriceRange } from "@/lib/services";
import { formatDuration } from "@/lib/duration";
import { book, confirmCode, findTimes, patchCheck, requestCode, reviewPromotion, reviewTerms, type DaySlot, type DayTimes, type PromotionResult, type TermsResult } from "./actions";
import { LinesSkeleton, TimesSkeleton } from "./skeleton";
import { accentLink, buttonSpinner, choiceClass, inputClass, primaryButton, secondaryButton, sectionTitle, smallButton } from "./styles";
import { DateStrip, TimeGrid, longDate } from "./times";

// A booking attempt's key (isAttemptKey on the server).
function newAttemptKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Step = "services" | "stylist" | "time" | "details" | "confirm";
const STEPS: Step[] = ["services", "stylist", "time", "details", "confirm"];
const STEP_TITLES: Record<Step, string> = {
  services: "Choose your services",
  stylist: "Choose your stylist",
  time: "Pick a date and time",
  details: "Your details",
  confirm: "Review and book",
};
const MAX_SERVICES = 4;

// The time chosen, with who does each service, the price and any special.
type Slot = DaySlot & { date: LocalDate };

type Identity =
  | { phase: "enter" }
  | { phase: "code"; verificationId: string; sentTo: string; demoCode?: string }
  | { phase: "done"; session: string; known: true; firstName: string }
  | { phase: "done"; session: string; known: false; channel: "sms" | "email"; contact: string };

// Chosen: an accent ring (border and an inner line).
const chosen = "border-(--accent) shadow-[inset_0_0_0_1px_var(--accent)]";
const notChosen = "border-line hover:border-(--accent-line)";

// signedIn: a client signed in to their account books as themselves (no
// code; the server sees the account, "account" in place of a code session).
// start: services (and a stylist) to begin with, from "Book this again", or
// the color after a patch test they've booked (`after`: no times before it).
export function BookingFlow({
  site,
  today,
  source,
  referral = null,
  quiz = null,
  signedIn = null,
  start = null,
}: {
  site: BookingSite;
  today: LocalDate;
  source: BookingSource;
  referral?: string | null;
  // The "Find my stylist" answers this booking came from.
  quiz?: string | null;
  signedIn?: { firstName: string; forClientId?: string } | null;
  start?: { serviceIds: string[]; staffId: string | null; after?: string | null } | null;
}) {
  const router = useRouter();
  const startIds = (start?.serviceIds ?? []).filter((id) => site.services.some((s) => s.id === id && s.mode === "bookable")).slice(0, MAX_SERVICES);
  const startStaff = startIds.length && start?.staffId && site.stylists.some((s) => s.id === start.staffId && startIds.every((id) => id in s.prices)) ? start.staffId : undefined;
  const [step, setStep] = useState<Step>(startIds.length ? (startStaff ? "time" : "stylist") : "services");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [serviceIds, setServiceIds] = useState<string[]>(startIds);
  // A service bundle chosen whole (its services, in its order, with its gaps).
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null | undefined>(startStaff);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [identity, setIdentity] = useState<Identity>(signedIn ? { phase: "done", session: signedIn.forClientId ? `account:${signedIn.forClientId}` : "account", known: true, firstName: signedIn.firstName } : { phase: "enter" });
  const [remember, setRemember] = useState(false);
  // Texts about their appointments (on unless they untick it) and offers (off unless they tick it).
  const [appointmentTexts, setAppointmentTexts] = useState(true);
  const [offers, setOffers] = useState(false);
  const [details, setDetails] = useState({ firstName: "", lastName: "", phone: "", email: "", note: "" });
  const [agreed, setAgreed] = useState(false);
  // The policy for this visit (from the server), and the card entered.
  const [loaded, setLoaded] = useState<{ key: string; terms: TermsResult } | null>(null);
  const cardField = useRef<CardFieldHandle>(null);
  // The promotion for the visit, as the server checked it for this client:
  // a code they applied, or the special picked with the time.
  const [promo, setPromo] = useState<{ key: string; code: string | null; result: PromotionResult } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockedServices, setBlockedServices] = useState<string[]>([]);
  // Color needing a patch test: what they said at the service step, the
  // color to book after a patch test they book first, and the server's
  // answer once it knows who they are (for this client, visit and time).
  const [patchAnswer, setPatchAnswer] = useState<"yes" | "no" | null>(null);
  const [colorAfter, setColorAfter] = useState<string[] | null>(null);
  const [patchChecked, setPatchChecked] = useState<{ key: string; message: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const honeypot = useRef<HTMLInputElement>(null);
  // This booking attempt's key: new each time they reach review, the same
  // while they tap Book again, so a dropped connection never books twice.
  const attempt = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The sticky Continue bar's height, as --continue-bar: every step keeps
  // that much room under its content, and anything scrolled into view (a
  // tap, the keyboard) stops above the bar instead of under it.
  const bar = useRef<HTMLDivElement>(null);
  // On a phone the salon's intro comes first: the bar waits below the
  // screen until the steps are well in view (their top above the lower
  // third), so a grey Continue never sits under Book now. Beside the intro
  // (from lg) the steps are always in view.
  const [barShown, setBarShown] = useState(true);
  useEffect(() => {
    const flow = root.current;
    if (!flow) return;
    const wide = window.matchMedia("(min-width: 64rem)");
    let inView = true;
    const update = () => setBarShown(wide.matches || inView);
    const watch = new IntersectionObserver(([entry]) => ((inView = entry.isIntersecting), update()), { rootMargin: "0px 0px -35% 0px" });
    watch.observe(flow);
    wide.addEventListener("change", update);
    return () => {
      watch.disconnect();
      wide.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    const el = bar.current;
    const flow = root.current;
    if (!el || !flow) return;
    const page = document.documentElement;
    const set = () => {
      const h = `${Math.ceil(el.getBoundingClientRect().height)}px`;
      flow.style.setProperty("--continue-bar", h);
      // A little more, so a card brought into view isn't flush against it.
      page.style.scrollPaddingBottom = `calc(${h} + 0.75rem)`;
    };
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => {
      watch.disconnect();
      page.style.scrollPaddingBottom = "";
    };
  }, []);

  const services = useMemo(() => new Map(site.services.map((s) => [s.id, s])), [site.services]);
  const selected = serviceIds.map((id) => services.get(id)!);
  const able = site.stylists.filter((s) => serviceIds.every((id) => id in s.prices));
  const stylist = staffId ? site.stylists.find((s) => s.id === staffId) ?? null : null;
  const bundle = bundleId ? site.bundles.find((b) => b.id === bundleId) ?? null : null;
  const totalMinutes = bundle ? bundle.minutes : selected.reduce((sum, s) => sum + s.minutes, 0);

  // What the visit costs: exact once there's a time (each service with its
  // stylist) or a chosen stylist, else the range across who could do each
  // service.
  const priceRange = (ids: string[], who: SiteStylist[] | null) => {
    if (who && who.length === 1) return [ids.reduce((sum, id) => sum + who[0].prices[id], 0)];
    const lows = ids.map((id) => Math.min(...site.stylists.filter((s) => id in s.prices).map((s) => s.prices[id])));
    const highs = ids.map((id) => Math.max(...site.stylists.filter((s) => id in s.prices).map((s) => s.prices[id])));
    return [lows.reduce((a, b) => a + b, 0), highs.reduce((a, b) => a + b, 0)];
  };
  const prices = !serviceIds.length ? [] : slot ? [slot.cents] : priceRange(serviceIds, stylist ? [stylist] : null);
  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) > STEPS.indexOf(step) ? 1 : -1);
    setNotice(null);
    // Agreeing is for the policy as shown for this exact visit.
    if (next === "confirm") {
      setAgreed(false);
      attempt.current = newAttemptKey();
    }
    setStep(next);
  };

  // Move focus to the new step's title, for keyboards and screen readers,
  // and bring it into view.
  // Only when the step changes (not on the first render, even when an effect
  // runs twice in development).
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    heading.current?.focus({ preventScroll: true });
    // The top of the steps (below the salon's intro on a phone).
    const top = root.current ? root.current.getBoundingClientRect().top + window.scrollY - 16 : 0;
    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [step]);

  // The policy is worked out for this exact visit when it's reviewed.
  const review = identity.phase === "done" && slot && step === "confirm" ? `${identity.session}|${bundleId}|${serviceIds.join(",")}|${staffId}|${slot.date}|${slot.minute}` : null;
  useEffect(() => {
    if (!review || identity.phase !== "done" || !slot) return;
    let live = true;
    reviewTerms(site.business.slug, identity.session, serviceIds, staffId ?? null, slot.date, slot.minute, bundleId).then((t) => {
      if (!live) return;
      setLoaded({ key: review, terms: t });
    });
    reviewPromotion(site.business.slug, identity.session, serviceIds, staffId ?? null, slot.date, slot.minute, null, slot.special?.id ?? null, bundleId).then(
      (result) => live && setPromo({ key: review, code: null, result }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `review` holds everything it depends on.
  }, [review]);
  const terms = loaded && loaded.key === review ? loaded.terms : null;
  const needsCard = terms?.ok === true && terms.cardNeeded && !terms.cardOnFile;
  const visitPromo = promo && promo.key === review ? promo : null;
  // Until the server has checked it, Review shows the special picked with the time.
  const shownPromo = visitPromo ?? (slot ? { code: null, result: { ok: true as const, promo: slot.special } } : null);
  const offer = shownPromo?.result.ok ? shownPromo.result.promo : null;
  const applyCode = async (code: string | null) => {
    if (identity.phase !== "done" || !slot || !review) return null;
    const result = await reviewPromotion(site.business.slug, identity.session, serviceIds, staffId ?? null, slot.date, slot.minute, code, slot.special?.id ?? null, bundleId);
    // A code that can't be used leaves what was there.
    if (result.ok) setPromo({ key: review, code, result });
    return result.ok ? null : result.message;
  };

  const needsPatch = selected.some((s) => s.requiresPatchTest);
  const patchKey = needsPatch && identity.phase === "done" && slot ? `${identity.session}|${serviceIds.join(",")}|${slot.date}|${slot.minute}` : null;
  useEffect(() => {
    if (!patchKey || identity.phase !== "done" || !slot) return;
    let live = true;
    patchCheck(site.business.slug, identity.session, serviceIds, slot.date, slot.minute).then((r) => live && setPatchChecked({ key: patchKey, message: r.ok ? null : r.message }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `patchKey` holds everything it depends on.
  }, [patchKey]);
  const patchReady = !patchKey || patchChecked?.key === patchKey;
  const patchMessage = patchKey && patchChecked?.key === patchKey ? patchChecked.message : null;
  // The patch test first (at the service the salon does them at), with the
  // color to book after it.
  const bookPatchFirst = () => {
    setColorAfter(serviceIds.filter((id) => id !== site.patchTest.serviceId));
    setServiceIds([site.patchTest.serviceId!]);
    setBundleId(null);
    setStaffId(undefined);
    setSlot(null);
    setPatchAnswer(null);
    setBlockedServices([]);
    if (step !== "services") go("services");
  };

  const toggleService = (id: string) => {
    setBlockedServices([]);
    setSlot(null);
    // A bundle is chosen whole: picking a single service starts again from it.
    if (bundle) {
      setBundleId(null);
      setServiceIds([id]);
    } else setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_SERVICES ? ids : [...ids, id]));
    // A stylist who doesn't do the new set is no longer a choice.
    setStaffId(undefined);
  };

  const toggleBundle = (id: string) => {
    setBlockedServices([]);
    setSlot(null);
    setStaffId(undefined);
    if (bundleId === id) {
      setBundleId(null);
      setServiceIds([]);
    } else {
      setBundleId(id);
      setServiceIds(site.bundles.find((b) => b.id === id)!.serviceIds);
    }
  };

  const submit = () => {
    if (identity.phase !== "done" || !slot) return;
    startTransition(async () => {
      // The card they chose (test mode) or entered on Stripe's form, first.
      let cardRef: string | undefined;
      if (needsCard) {
        const chosen = await cardField.current?.cardRef();
        if (!chosen?.ok) return setNotice(chosen?.message ?? "Add a card to hold your booking.");
        cardRef = chosen.ref;
      }
      const sent = await book(site.business.slug, {
        session: identity.session,
        serviceIds,
        bundleId,
        staffId: staffId ?? null,
        date: slot.date,
        minute: slot.minute,
        ...(identity.known ? {} : details),
        note: details.note,
        agreed,
        honeypot: honeypot.current?.value ?? "",
        source,
        referral: referral ?? undefined,
        quiz: quiz ?? undefined,
        cardRef,
        remember: !signedIn && remember,
        appointmentTexts,
        offers,
        promoCode: visitPromo?.code ?? undefined,
        specialId: !visitPromo?.code && offer ? offer.id : undefined,
        expectedCents: slot.cents,
        attempt: attempt.current,
      }).catch(() => null);
      // No answer: it may or may not have booked, and tapping Book again
      // with the same attempt finds out without booking twice.
      if (!sent) return setNotice("We couldn't reach the salon. Check your connection and tap Book again: you won't be booked twice.");
      const result = sent;
      // Any other answer (but "still booking it") ends the attempt.
      if (!result.ok && result.reason !== "pending") attempt.current = newAttemptKey();
      if (result.ok) {
        const patchFirst = colorAfter?.length && site.patchTest.serviceId && serviceIds.includes(site.patchTest.serviceId);
        router.push(patchFirst ? `${result.manageUrl}&then=${colorAfter.join(",")}` : result.manageUrl);
        return;
      }
      if (result.reason === "taken") {
        setSlot(null);
        go("time");
        setNotice(result.message);
      } else if (result.reason === "patch_test") {
        setBlockedServices(result.serviceIds ?? []);
        go("services");
        setNotice(result.message);
      } else if (result.reason === "promotion" && result.lost && review) {
        // The special stopped applying since Review: Review now says so.
        setPromo({ key: review, code: null, result: { ok: true, promo: null, lost: result.message } });
      } else if (result.reason === "session") {
        setIdentity({ phase: "enter" });
        go("details");
        setNotice(result.message);
      } else {
        setNotice(result.message);
      }
    });
  };

  const index = STEPS.indexOf(step);
  const canContinue =
    (step === "services" && serviceIds.length > 0 && (!needsPatch || patchAnswer === "yes")) ||
    (step === "stylist" && staffId !== undefined) ||
    (step === "time" && slot !== null) ||
    (step === "details" && identity.phase === "done" && patchReady && !patchMessage && (identity.known || (site.settings.allowNewClients && detailsComplete(details, identity.channel))));

  return (
    <div ref={root} className="flex flex-1 flex-col" data-testid="booking-flow">
      {/* On the first step, with no Back, the step's name sits just above
          its title. */}
      <nav aria-label="Booking steps" className={`flex items-center gap-3 ${index > 0 ? "mb-3 min-h-11" : "mb-1.5"}`}>
        {index > 0 && (
          <button
            type="button"
            onClick={() => go(STEPS[index - 1])}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-muted transition-colors duration-(--motion-fast) hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span aria-hidden>←</span> Back
          </button>
        )}
        <p className={`text-13 font-medium text-ink-muted ${index > 0 ? "ml-auto" : ""}`} aria-current="step" data-testid="step-label">
          {stepLabel(index)}
        </p>
      </nav>

      <section
        key={step}
        aria-labelledby="step-title"
        className="flex flex-1 animate-step-in flex-col pb-(--continue-bar)"
        style={{ "--step-from": `${direction * 16}px` } as React.CSSProperties}
      >
        <h2 id="step-title" ref={heading} tabIndex={-1} className="mb-4 font-serif text-2xl font-semibold tracking-[-0.01em] text-ink focus:outline-none">
          {STEP_TITLES[step]}
        </h2>

        {notice && (
          <Alert className="mb-4">{notice}</Alert>
        )}

        {step === "services" && (
          <ServicesStep
            site={site}
            selected={bundle ? [] : serviceIds}
            bundleId={bundleId}
            blocked={blockedServices}
            onToggle={toggleService}
            onBundle={toggleBundle}
            onConsultation={() => {
              const id = site.settings.consultationServiceId!;
              setBlockedServices([]);
              setSlot(null);
              setStaffId(undefined);
              setBundleId(null);
              setServiceIds((ids) => (bundle ? [id] : ids.includes(id) ? ids : [...ids, id].slice(-MAX_SERVICES)));
            }}
          />
        )}
        {step === "services" && needsPatch && <PatchQuestion site={site} answer={patchAnswer} onAnswer={setPatchAnswer} onBookTest={bookPatchFirst} />}

        {step === "stylist" && (
          <StylistStep site={site} serviceIds={serviceIds} able={able} chosen={staffId} priceRange={priceRange} onChoose={(id) => (setStaffId(id), setSlot(null))} />
        )}

        {step === "time" && (
          <TimeStep
            key={`${bundleId}:${serviceIds.join(",")}:${staffId}`}
            slug={site.business.slug}
            today={today}
            serviceIds={serviceIds}
            bundleId={bundleId}
            staffId={staffId ?? null}
            stylists={site.stylists}
            slot={slot}
            onPick={setSlot}
            notBefore={start?.after && serviceIds.join(",") === startIds.join(",") ? start.after : null}
            timezone={site.location.timezone}
          />
        )}

        {step === "details" && (
          <DetailsStep
            site={site}
            identity={identity}
            setIdentity={setIdentity}
            details={details}
            setDetails={setDetails}
            honeypot={honeypot}
          />
        )}
        {step === "details" && patchMessage && (
          <div className="mt-5 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" data-testid="patch-check">
            <p className="text-sm text-ink">{patchMessage}</p>
            {site.patchTest.serviceId && (
              <button type="button" className={`${secondaryButton} self-start`} onClick={bookPatchFirst}>
                Book a patch test first
              </button>
            )}
          </div>
        )}

        {step === "confirm" && slot && (
          <ConfirmStep
            site={site}
            slot={slot}
            noPreference={staffId === null}
            terms={terms}
            cardField={cardField}
            agreed={agreed}
            appointmentTexts={appointmentTexts}
            setAppointmentTexts={setAppointmentTexts}
            offers={offers}
            setOffers={setOffers}
            setAgreed={setAgreed}
            promo={shownPromo}
            onCode={applyCode}
          />
        )}
        {step === "confirm" && slot && !signedIn && (
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-5 accent-(--accent)" />
            <span>
              <span className="font-medium">Keep me signed in on this device</span>
              <span className="block text-ink-muted">Creates your account, to see and change your visits without a code next time.</span>
            </span>
          </label>
        )}
      </section>

      <div
        ref={bar}
        data-testid="continue-bar"
        data-hidden={barShown ? undefined : ""}
        inert={!barShown}
        className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-[translate,opacity] duration-(--motion-base) data-hidden:pointer-events-none data-hidden:translate-y-full data-hidden:opacity-0"
      >
        {serviceIds.length > 0 && step !== "confirm" && (
          <p className="mb-2 flex justify-between gap-3 text-sm text-ink-muted" data-testid="summary">
            <span>
              {bundle ? bundle.name : `${serviceIds.length} ${serviceIds.length === 1 ? "service" : "services"}`} · {formatDuration(totalMinutes)}
              {slot && ` · ${longDate(slot.date, true)}, ${formatMinute(slot.minute)}`}
            </span>
            <span className="font-medium text-ink tabular-nums">{formatPriceRange(prices)}</span>
          </p>
        )}
        {step === "confirm" ? (
          <button type="button" className={primaryButton} disabled={!agreed || pending || terms?.ok !== true} onClick={submit}>
            {pending ? "Booking…" : terms?.ok && terms.depositCents > 0 ? `Pay ${formatPrice(terms.depositCents)} deposit and book` : "Book appointment"}
          </button>
        ) : (
          // On the details step, the code form has its own button until it's done.
          (step !== "details" || (identity.phase === "done" && !patchMessage)) && (
            <button type="button" className={primaryButton} disabled={!canContinue} onClick={() => go(STEPS[index + 1])}>
              Continue
            </button>
          )
        )}
      </div>
    </div>
  );
}

function detailsComplete(d: { firstName: string; phone: string; email: string }, channel: "sms" | "email") {
  if (!d.firstName.trim()) return false;
  return channel === "sms" ? /\S+@\S+\.\S+/.test(d.email) : d.phone.replace(/\D/g, "").length >= 10;
}

function ServicesStep({
  site,
  selected,
  bundleId,
  blocked,
  onToggle,
  onBundle,
  onConsultation,
}: {
  site: BookingSite;
  selected: string[];
  bundleId: string | null;
  blocked: string[];
  onToggle: (id: string) => void;
  onBundle: (id: string) => void;
  onConsultation: () => void;
}) {
  const categories = [...new Set(site.services.map((s) => s.category))];
  const price = (s: SiteService) => fromPrice(site.stylists.filter((st) => s.id in st.prices).map((st) => st.prices[s.id]));
  const names = new Map(site.services.map((s) => [s.id, s.name]));
  // A bundle's price: each service on its own, "From" the lowest stylist prices.
  const range = (id: string) => site.stylists.filter((st) => id in st.prices).map((st) => st.prices[id]);
  const bundlePrice = (ids: string[]) => fromPrice([ids.reduce((sum, id) => sum + Math.min(...range(id)), 0), ids.reduce((sum, id) => sum + Math.max(...range(id)), 0)]);
  return (
    <div className="flex flex-col gap-8">
      {site.bundles.length > 0 && (
        <section aria-labelledby="cat-bundles">
          <h3 id="cat-bundles" className="mb-2 text-base font-semibold text-ink">
            Bundles
          </h3>
          <ul className="flex flex-col gap-2">
            {site.bundles.map((b) => {
              const on = bundleId === b.id;
              return (
                <li key={b.id}>
                  <button type="button" aria-pressed={on} onClick={() => onBundle(b.id)} className={`${choiceClass} items-start! ${on ? chosen : notChosen}`}>
                    <span
                      aria-hidden
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-xs text-white transition-colors duration-(--motion-fast) ${on ? "border-(--accent) bg-(--accent)" : "border-line-strong bg-surface"}`}
                    >
                      {on && "✓"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">{b.name}</span>
                      <span className="mt-0.5 block text-13 text-ink-muted">
                        {formatDuration(b.minutes)} · {b.serviceIds.map((id) => names.get(id)).join(", then ")}
                      </span>
                      {b.description && <span className="mt-1 block text-sm leading-snug text-ink-muted">{b.description}</span>}
                    </span>
                    <span className="shrink-0 self-start pt-0.5 text-sm font-medium text-ink tabular-nums">{bundlePrice(b.serviceIds)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {categories.map((category) => (
        <section key={category} aria-labelledby={`cat-${category}`}>
          {site.categoryPhotos[category] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={site.categoryPhotos[category]} alt="" loading="lazy" data-testid="category-photo" className="mb-3 aspect-[5/2] w-full rounded-lg bg-sunken object-cover md:aspect-[4/1]" />
          )}
          <h3 id={`cat-${category}`} className="mb-2 text-base font-semibold text-ink">
            {category}
          </h3>
          <ul className="flex flex-col gap-2">
            {site.services
              .filter((s) => s.category === category)
              .map((s) => {
                const on = selected.includes(s.id);
                const deposit = describeDeposit(s.depositKind, s.depositAmount);
                if (s.mode === "consultation") {
                  return (
                    <li key={s.id} className="rounded-lg border border-line bg-surface px-4 py-3">
                      <p className="font-medium text-ink">{s.name}</p>
                      {s.description && <p className="mt-0.5 text-sm text-ink-muted">{s.description}</p>}
                      <p className="mt-0.5 text-sm text-ink-muted">We&rsquo;ll start with a consultation to plan this together.</p>
                      {site.settings.consultationServiceId ? (
                        <button type="button" onClick={onConsultation} className={`${smallButton} mt-3`}>
                          Request a consultation
                        </button>
                      ) : (
                        <p className="mt-1 text-sm text-ink">Call {site.location.phone ?? "the salon"} to arrange one.</p>
                      )}
                    </li>
                  );
                }
                return (
                  <li key={s.id}>
                    <button type="button" aria-pressed={on} onClick={() => onToggle(s.id)} className={`${choiceClass} items-start! ${on ? chosen : notChosen}`}>
                      <span
                        aria-hidden
                        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-xs text-white transition-colors duration-(--motion-fast) ${on ? "border-(--accent) bg-(--accent)" : "border-line-strong bg-surface"}`}
                      >
                        {on && "✓"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-ink">{s.name}</span>
                        <span className="mt-0.5 block text-13 text-ink-muted">
                          {formatDuration(s.minutes)}
                          {deposit && ` · ${deposit}`}
                        </span>
                        {s.description && <span className="mt-1 block text-sm leading-snug text-ink-muted">{s.description}</span>}
                        {s.requiresPatchTest && (
                          <span data-testid="patch-note" className={`mt-1.5 block text-13 font-medium ${blocked.includes(s.id) ? "text-danger" : "text-ink"}`}>
                            New clients need a patch test {site.patchTest.minHours} hours before color.
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 self-start pt-0.5 text-sm font-medium text-ink tabular-nums">{price(s)}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      {selected.length >= MAX_SERVICES && <p className="text-sm text-ink-muted">You can book up to {MAX_SERVICES} services online.</p>}
    </div>
  );
}

// At the service step, for color that needs a patch test: whether they've
// had one, and if not, the next step (book one first, or call).
function PatchQuestion({ site, answer, onAnswer, onBookTest }: { site: BookingSite; answer: "yes" | "no" | null; onAnswer: (a: "yes" | "no") => void; onBookTest: () => void }) {
  const months = Math.round(site.patchTest.validDays / 30.4);
  const hours = site.patchTest.minHours;
  const patchService = site.services.find((s) => s.id === site.patchTest.serviceId);
  return (
    <div role="group" aria-label="Patch test" className="mt-6 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <p className="font-medium text-ink">Have you had a patch test with us in the last {months} months?</p>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["yes", "Yes, I have"],
            ["no", "No, not yet"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={answer === value} onClick={() => onAnswer(value)} className={`${choiceClass} justify-center ${answer === value ? chosen : notChosen}`}>
            {label}
          </button>
        ))}
      </div>
      {answer === "yes" && <p className="text-sm text-ink-muted">We&rsquo;ll check it when you confirm your details, before you book.</p>}
      {answer === "no" &&
        (patchService ? (
          <>
            <p className="text-sm text-ink">
              Color needs a patch test at least {hours} hours before. Book a quick patch test first ({patchService.name}, {formatDuration(patchService.minutes)}), and we&rsquo;ll take you to book your color for {hours} hours or more after it.
            </p>
            <button type="button" className={`${primaryButton} self-start`} onClick={onBookTest}>
              Book a patch test first
            </button>
          </>
        ) : (
          <p className="text-sm text-ink">
            Color needs a patch test at least {hours} hours before. {site.location.phone ? `Call us on ${site.location.phone}` : "Call the salon"} to book one, then book your color online.
          </p>
        ))}
    </div>
  );
}

function StylistStep({
  site,
  serviceIds,
  able,
  chosen: current,
  priceRange,
  onChoose,
}: {
  site: BookingSite;
  serviceIds: string[];
  able: SiteStylist[];
  chosen: string | null | undefined;
  priceRange: (ids: string[], who: SiteStylist[] | null) => number[];
  onChoose: (id: string | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      <li>
        <button type="button" aria-pressed={current === null} onClick={() => onChoose(null)} className={`${choiceClass} ${current === null ? chosen : notChosen}`}>
          <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-sunken text-xl text-ink-muted">
            ✦
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink">No preference</span>
            <span className="block text-sm text-ink-muted">The first stylist free at your time</span>
          </span>
          <span className="shrink-0 self-start pt-0.5 text-sm font-medium text-ink tabular-nums">{formatPriceRange(priceRange(serviceIds, null))}</span>
        </button>
      </li>
      {able.map((s) => (
        <StylistCard key={s.id} stylist={s} on={current === s.id} price={formatPrice(serviceIds.reduce((sum, id) => sum + s.prices[id], 0))} onChoose={() => onChoose(s.id)} />
      ))}
      {able.length === 0 && (
        <li className="text-sm text-ink-muted">No one stylist does all of these, so we&rsquo;ll match each service with someone who does.</li>
      )}
      {site.stylists.length > 0 && <li className="sr-only">Prices are for everything you chose.</li>}
    </ul>
  );
}

// A stylist to choose: their portrait (or initials), full name, level and
// specialty, and what it costs with them. "About" opens their bio and up to
// three photos of their work, without choosing them.
function StylistCard({ stylist: s, on, price, onChoose }: { stylist: SiteStylist; on: boolean; price: string; onChoose: () => void }) {
  const levels = useLevels();
  const [open, setOpen] = useState(false);
  const more = Boolean(s.bio || s.portfolio.length);
  return (
    <li className={`rounded-lg border bg-surface transition-[border-color,box-shadow] duration-(--motion-fast) ${on ? chosen : notChosen}`} data-testid="stylist-card">
      <button
        type="button"
        aria-pressed={on}
        onClick={onChoose}
        className="flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {s.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.photoUrl} alt="" loading="lazy" data-testid="stylist-portrait" className="h-20 w-16 shrink-0 rounded-md bg-sunken object-cover" />
        ) : (
          <span className="flex h-20 w-16 shrink-0 items-center justify-center">
            <Avatar name={s.displayName} color={s.color} level={s.level} size="lg" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{s.displayName}</span>
          {s.level && (
            <span className="mt-0.5 flex items-center gap-1.5 text-13 text-ink-muted">
              {s.photoUrl && <LevelBadge level={s.level} className="size-3.5" />}
              {levelTitle(levels, s.level)}
            </span>
          )}
          {s.specialty && <span className="mt-1 block text-sm leading-snug text-ink">{s.specialty}</span>}
        </span>
        <span className="shrink-0 self-start pt-0.5 text-sm font-medium text-ink tabular-nums">{price}</span>
      </button>
      {more && (
        <div className="-mt-1 px-4 pb-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="-mx-1 inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-13 font-medium text-(--accent) focus-visible:outline-2 focus-visible:outline-focus"
          >
            {open ? "Less" : `About ${s.firstName}`}
            <ChevronDownIcon className={`size-4 ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div className="mt-1 flex flex-col gap-3" data-testid="stylist-about">
              {s.bio && <p className="text-sm leading-relaxed text-ink-muted">{s.bio}</p>}
              {s.portfolio.length > 0 && (
                <ul className="grid grid-cols-3 gap-2" aria-label={`${s.firstName}'s work`}>
                  {s.portfolio.map((url, i) => (
                    <li key={url}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`${s.firstName}'s work, photo ${i + 1}`} loading="lazy" className="aspect-square w-full rounded-md bg-sunken object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function TimeStep({
  slug,
  today,
  serviceIds,
  bundleId,
  staffId,
  stylists,
  slot,
  onPick,
  notBefore,
  timezone,
}: {
  slug: string;
  today: LocalDate;
  serviceIds: string[];
  bundleId: string | null;
  staffId: string | null;
  stylists: SiteStylist[];
  slot: { date: LocalDate; minute: number } | null;
  onPick: (slot: Slot) => void;
  // No times before this (48 hours after a patch test they've booked).
  notBefore: string | null;
  timezone: string;
}) {
  const [days, setDays] = useState<DayTimes[] | null>(null);
  const [lastDay, setLastDay] = useState<LocalDate | null>(null);
  const [date, setDate] = useState<LocalDate | null>(slot?.date ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const load = (from: LocalDate) =>
    startLoading(async () => {
      const result = await findTimes(slug, serviceIds, staffId, from, undefined, notBefore ?? undefined, bundleId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setLastDay(result.lastDay);
      setDays((prev) => {
        const merged = [...(prev ?? []).filter((d) => d.date < from), ...result.days];
        return merged;
      });
      // Start on the first day with times.
      setDate((current) => current ?? result.days.find((d) => d.times.length)?.date ?? result.days[0]?.date ?? null);
    });

  useEffect(() => {
    const first = notBefore ? toLocal(new Date(notBefore), timezone).date : today;
    load(first > today ? first : today);
    // Loads once for these services and stylist (the step remounts when they change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const day = days?.find((d) => d.date === date);
  const nextFrom = days?.length ? days.at(-1)!.date : null;
  const name = (id: string) => stylists.find((s) => s.id === id)?.firstName ?? "";

  if (error) return <Alert>{error}</Alert>;
  if (!days) return <TimesSkeleton />;

  return (
    <div className="flex flex-col gap-5" aria-busy={loading}>
      <DateStrip
        days={days}
        selected={date}
        onSelect={setDate}
        onMore={nextFrom && lastDay && nextFrom < lastDay ? () => load(nextDay(nextFrom)) : null}
        loading={loading}
      />
      {days.some((d) => d.times.some((t) => t.special)) && (
        <p className="rounded-lg bg-(--accent-soft) px-3 py-2.5 text-sm text-ink" data-testid="specials-note">
          Specials: times marked with a price or discount have it taken off when you pay.
        </p>
      )}
      {day && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-ink">{longDate(day.date)}</h2>
          {day.times.length ? (
            <TimeGrid
              times={day.times}
              selected={slot && slot.date === day.date ? slot.minute : null}
              onPick={(t) => onPick({ date: day.date, ...t })}
              label={staffId === null ? (t) => t.staffIds.map(name).join(" & ") : undefined}
              badge={(t) => t.special?.text ?? null}
            />
          ) : (
            <p className="py-8 text-center text-ink-muted">No times this day. Try another date.</p>
          )}
        </div>
      )}
    </div>
  );
}

function nextDay(date: LocalDate): LocalDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function DetailsStep({
  site,
  identity,
  setIdentity,
  details,
  setDetails,
  honeypot,
}: {
  site: BookingSite;
  identity: Identity;
  setIdentity: (i: Identity) => void;
  details: { firstName: string; lastName: string; phone: string; email: string; note: string };
  setDetails: React.Dispatch<React.SetStateAction<{ firstName: string; lastName: string; phone: string; email: string; note: string }>>;
  honeypot: React.RefObject<HTMLInputElement | null>;
}) {
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  // What was sent to, for "Send a new code" (the field itself is read when
  // the form is sent, so a number the browser filled in counts even when no
  // typing event came).
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (to = value) => {
    if (pending) return;
    if (!to.trim()) return setError(channel === "sms" ? "Enter your mobile number." : "Enter your email address.");
    setValue(to);
    start(async () => {
      const result = await requestCode(site.business.slug, channel, to, honeypot.current?.value ?? "");
      if (!result.ok) return setError(result.message);
      setError(null);
      setCode("");
      setIdentity({ phase: "code", verificationId: result.verificationId, sentTo: result.sentTo, demoCode: result.demoCode });
    });
  };

  const check = (verificationId: string) =>
    start(async () => {
      const result = await confirmCode(site.business.slug, verificationId, code);
      if (!result.ok) return setError(result.message);
      setError(null);
      setIdentity(result.client.known ? { phase: "done", session: result.session, known: true, firstName: result.client.firstName } : { phase: "done", session: result.session, ...result.client });
      if (!result.client.known) {
        const c = result.client;
        setDetails((d) => (c.channel === "sms" ? { ...d, phone: c.contact } : { ...d, email: c.contact }));
      }
    });

  const set = (key: keyof typeof details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDetails((d) => ({ ...d, [key]: e.target.value }));

  return (
    <div className="flex flex-col gap-5">
      {/* For bots: people never see or fill this. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {identity.phase === "enter" && (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send(String(new FormData(e.currentTarget).get("contact") ?? ""));
          }}
        >
          <p className="text-ink-muted">We&rsquo;ll send you a code to confirm it&rsquo;s you. Booked with us before? We&rsquo;ll find your details.</p>
          <div role="radiogroup" aria-label="Send the code by" className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
            {(["sms", "email"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                onClick={() => (setChannel(c), setValue(""), setError(null))}
                className={`min-h-11 rounded-md text-sm font-medium transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-focus ${channel === c ? "bg-surface text-ink ring-1 ring-line-strong" : "text-ink-muted hover:text-ink"}`}
              >
                {c === "sms" ? "Text me" : "Email me"}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            {channel === "sms" ? "Mobile number" : "Email"}
            <input
              key={channel}
              name="contact"
              className={inputClass}
              defaultValue={value}
              onChange={() => error && setError(null)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "contact-error" : undefined}
              type={channel === "sms" ? "tel" : "email"}
              inputMode={channel === "sms" ? "tel" : "email"}
              autoComplete={channel === "sms" ? "tel" : "email"}
              placeholder={channel === "sms" ? "(312) 555-0123" : "you@example.com"}
              required
            />
          </label>
          {error && (
            <div id="contact-error">
              <Alert>{error}</Alert>
            </div>
          )}
          <button type="submit" className={primaryButton} aria-busy={pending || undefined}>
            {pending && <span aria-hidden className={buttonSpinner} />}
            {pending ? "Sending your code…" : "Send code"}
          </button>
          {!site.settings.allowNewClients && (
            <p className="text-sm text-ink-muted">New clients: please call {site.location.phone ?? "the salon"} to book your first visit.</p>
          )}
        </form>
      )}

      {identity.phase === "code" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            check(identity.verificationId);
          }}
        >
          <p className="text-ink-muted">
            If {identity.sentTo} is yours, we&rsquo;ve sent it a 6-digit code. It expires in 10 minutes.
          </p>
          <DemoCode code={identity.demoCode} />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Code
            <input
              className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
            />
          </label>
          {error && <Alert>{error}</Alert>}
          <button type="submit" className={primaryButton} disabled={pending || code.length !== 6}>
            {pending ? "Checking…" : "Confirm"}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className={`min-h-11 ${accentLink}`} onClick={() => send()} disabled={pending}>
              Send a new code
            </button>
            <button type="button" className={`min-h-11 ${accentLink}`} onClick={() => (setIdentity({ phase: "enter" }), setError(null))}>
              Use a different {channel === "sms" ? "number" : "email"}
            </button>
          </div>
        </form>
      )}

      {identity.phase === "done" && identity.known && (
        <p className="rounded-lg bg-(--accent-soft) px-4 py-3 text-ink" data-testid="welcome-back">
          Welcome back, <span className="font-semibold">{identity.firstName}</span>. You&rsquo;re all set.
        </p>
      )}

      {identity.phase === "done" && !identity.known && !site.settings.allowNewClients && (
        <Alert tone="warning">
          We couldn&rsquo;t find you in our records, and new clients book by phone. Please call {site.location.phone ?? "the salon"}.
        </Alert>
      )}

      {identity.phase === "done" && !identity.known && site.settings.allowNewClients && (
        <div className="flex flex-col gap-4">
          <p className="text-ink-muted">Welcome! Tell us a little about you.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              First name
              <input className={inputClass} value={details.firstName} onChange={set("firstName")} autoComplete="given-name" maxLength={60} required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Last name
              <input className={inputClass} value={details.lastName} onChange={set("lastName")} autoComplete="family-name" maxLength={60} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Mobile number
            <input className={inputClass} value={details.phone} onChange={set("phone")} readOnly={identity.channel === "sms"} type="tel" autoComplete="tel" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Email
            <input className={inputClass} value={details.email} onChange={set("email")} readOnly={identity.channel === "email"} type="email" autoComplete="email" />
          </label>
        </div>
      )}

      {identity.phase === "done" && (identity.known || site.settings.allowNewClients) && (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Anything we should know? <span className="font-normal text-ink-muted">Optional</span>
          <textarea className={`${inputClass} min-h-24 py-3`} value={details.note} onChange={set("note")} maxLength={500} />
        </label>
      )}
    </div>
  );
}

function ConfirmStep({
  site,
  slot,
  noPreference,
  terms,
  cardField,
  agreed,
  setAgreed,
  appointmentTexts,
  setAppointmentTexts,
  offers,
  setOffers,
  promo,
  onCode,
}: {
  site: BookingSite;
  slot: Slot;
  noPreference: boolean;
  terms: TermsResult | null;
  cardField: React.RefObject<CardFieldHandle | null>;
  agreed: boolean;
  appointmentTexts: boolean;
  setAppointmentTexts: (on: boolean) => void;
  offers: boolean;
  setOffers: (on: boolean) => void;
  setAgreed: (v: boolean) => void;
  promo: { code: string | null; result: PromotionResult } | null;
  onCode: (code: string | null) => Promise<string | null>;
}) {
  const card = terms?.ok && terms.cardNeeded;
  const offer = promo?.result.ok ? promo.result.promo : null;
  const lost = promo?.result.ok ? promo.result.lost : undefined;
  const discount = offer?.discountCents ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <p className="text-base font-semibold text-ink">{longDate(slot.date)}</p>
          <p className="text-sm text-ink-muted">
            {formatMinute(slot.minute)} · {site.location.name}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {slot.items.map((item) => {
            const service = site.services.find((s) => s.id === item.serviceId)!;
            const who = site.stylists.find((s) => s.id === item.staffId);
            return (
              <li key={item.serviceId} className="flex items-baseline justify-between gap-3 px-4 py-3" data-testid="review-line">
                <span>
                  <span className="block font-medium text-ink">{service.name}</span>
                  <span className="text-sm text-ink-muted">
                    {formatDuration(service.minutes)}
                    {who && ` · with ${who.firstName}`}
                  </span>
                </span>
                <span className="text-sm font-medium text-ink tabular-nums" data-testid="line-price">
                  {formatPrice(who?.prices[item.serviceId] ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>
        {offer && (
          <div className="border-t border-line bg-(--accent-soft) px-4 py-3" data-testid="online-promotion">
            <p className="flex justify-between gap-3 font-medium text-ink">
              <span>{offer.label}</span>
              <span className="tabular-nums">−{formatPrice(offer.discountCents)}</span>
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">Taken off when you pay at your visit.</p>
          </div>
        )}
        <div className="flex justify-between border-t border-line px-4 py-3 font-semibold text-ink">
          <span>Total</span>
          <span className="tabular-nums" data-testid="review-total">
            {formatPrice(slot.cents - discount)}
          </span>
        </div>
        {noPreference && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">If they&rsquo;re booked by the time you confirm, we&rsquo;ll match you with another stylist who&rsquo;s free.</p>
        )}
      </div>

      {lost && (
        <Alert tone="info">
          <span data-testid="offer-lost">{lost}</span>
        </Alert>
      )}

      <PromoCode promo={promo} onCode={onCode} />

      {terms === null ? (
        <LinesSkeleton label="Getting the cancellation policy…" />
      ) : !terms.ok ? (
        <Alert>{terms.message}</Alert>
      ) : (
        <>
          <section aria-labelledby="policy-heading" data-testid="policy">
            <h2 id="policy-heading" className={sectionTitle}>
              Cancellation policy
            </h2>
            <div className="mt-3 flex flex-col gap-1.5 text-sm text-ink-muted">
              {terms.lines.map((line) => (
                <p key={line} className="whitespace-pre-line">
                  {line}
                </p>
              ))}
            </div>
          </section>

          {terms.depositCents > 0 && (
            <div className="border-y border-line py-3" data-testid="deposit">
              <p className="flex justify-between font-semibold text-ink">
                <span>Deposit, paid now</span>
                <span className="tabular-nums">{formatPrice(terms.depositCents)}</span>
              </p>
              <p className="mt-1 text-sm text-ink-muted">It comes off your bill at the visit.</p>
            </div>
          )}

          {card && (
            <section aria-labelledby="card-heading">
              <h2 id="card-heading" className={sectionTitle}>
                {terms.cardOnFile ? "Your card on file" : "Card to hold your booking"}
              </h2>
              {terms.cardOnFile ? (
                <p className="mt-3 text-sm text-ink">{terms.cardOnFile}</p>
              ) : (
                <div className="mt-3">
                  <CardField ref={cardField} form={terms.cardForm} selectClassName={inputClass} />
                </div>
              )}
              <p className="mt-2 text-xs text-ink-subtle">Card details go to the payment provider; {site.business.name} never sees or stores them.</p>
            </section>
          )}

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-ink">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 shrink-0 accent-(--accent)" />
            {card ? "I agree to the cancellation policy and to my card being saved for it" : "I agree to the cancellation policy"}
          </label>
        </>
      )}
      {terms?.ok === true && (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Messages</legend>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={appointmentTexts} onChange={(e) => setAppointmentTexts(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-(--accent)" />
            {APPOINTMENT_TEXTS_CONSENT}
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={offers} onChange={(e) => setOffers(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-(--accent)" />
            {MARKETING_CONSENT}
          </label>
        </fieldset>
      )}
    </div>
  );
}

// A place to enter a promo code (it takes the special's place), and to
// take it off again. What it takes off is in the visit's summary above.
function PromoCode({ promo, onCode }: { promo: { code: string | null; result: PromotionResult } | null; onCode: (code: string | null) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      {promo?.code && (
        <button type="button" className={`min-h-9 self-start text-sm ${accentLink}`} onClick={() => start(async () => void (await onCode(null)))}>
          Remove code
        </button>
      )}
      {!promo?.code &&
        (open ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const problem = await onCode(code);
                if (problem) setError(problem);
                else setOpen(false);
              });
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Promo code
              <span className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} uppercase`} autoCapitalize="characters" autoComplete="off" maxLength={24} />
                <button type="submit" disabled={pending || !code.trim()} className={`${secondaryButton} shrink-0`}>
                  Apply
                </button>
              </span>
            </label>
            {error && (
              <Alert>{error}</Alert>
            )}
          </form>
        ) : (
          <button type="button" className={`min-h-9 self-start text-sm ${accentLink}`} onClick={() => setOpen(true)}>
            Have a promo code?
          </button>
        ))}
    </div>
  );
}
