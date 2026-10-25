"use client";

import { APPOINTMENT_TEXTS_CONSENT, MARKETING_CONSENT } from "@/lib/messaging/consent";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import type { BookingSite, SiteService, SiteStylist } from "@/lib/online-booking/site";
import { describeDeposit } from "@/lib/online-booking/settings";
import type { BookingSource } from "@/lib/online-booking/sources";
import { LEVEL_LABELS } from "@/lib/schedule-forms";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { formatMinutes, formatPrice, formatPriceRange } from "@/lib/services";
import { book, confirmCode, findTimes, requestCode, reviewPromotion, reviewTerms, type DayTimes, type PromotionResult, type TermsResult } from "./actions";
import { DateStrip, TimeGrid, longDate } from "./times";

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

type Identity =
  | { phase: "enter" }
  | { phase: "code"; verificationId: string; sentTo: string }
  | { phase: "done"; session: string; known: true; firstName: string }
  | { phase: "done"; session: string; known: false; channel: "sms" | "email"; contact: string };

export const primaryButton =
  "inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-(--accent) px-6 text-base font-semibold text-white shadow-card transition-[filter,opacity] duration-(--motion-fast) hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40";
export const choiceClass =
  "group flex min-h-16 w-full items-center gap-4 rounded-xl border bg-surface px-4 py-3 text-left transition-[border-color,background-color,box-shadow] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const chosen = "border-(--accent) bg-(--accent-soft) shadow-[inset_0_0_0_1px_var(--accent)]";
const notChosen = "border-line hover:border-(--accent-line)";
export const inputClass =
  "min-h-13 w-full rounded-xl border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-subtle focus:border-focus focus:ring-3 focus:ring-focus/25 focus:outline-none";

// signedIn: a client signed in to their account books as themselves (no
// code; the server sees the account, "account" in place of a code session).
// start: services (and a stylist) to begin with, from "Book this again".
export function BookingFlow({
  site,
  today,
  source,
  signedIn = null,
  start = null,
}: {
  site: BookingSite;
  today: LocalDate;
  source: BookingSource;
  signedIn?: { firstName: string } | null;
  start?: { serviceIds: string[]; staffId: string | null } | null;
}) {
  const router = useRouter();
  const startIds = (start?.serviceIds ?? []).filter((id) => site.services.some((s) => s.id === id && s.mode === "bookable")).slice(0, MAX_SERVICES);
  const startStaff = startIds.length && start?.staffId && site.stylists.some((s) => s.id === start.staffId && startIds.every((id) => id in s.prices)) ? start.staffId : undefined;
  const [step, setStep] = useState<Step>(startIds.length ? (startStaff ? "time" : "stylist") : "services");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [serviceIds, setServiceIds] = useState<string[]>(startIds);
  const [staffId, setStaffId] = useState<string | null | undefined>(startStaff);
  const [slot, setSlot] = useState<{ date: LocalDate; minute: number; staffIds: string[] } | null>(null);
  const [identity, setIdentity] = useState<Identity>(signedIn ? { phase: "done", session: "account", known: true, firstName: signedIn.firstName } : { phase: "enter" });
  const [remember, setRemember] = useState(false);
  // Texts about their appointments (on unless they untick it) and offers (off unless they tick it).
  const [appointmentTexts, setAppointmentTexts] = useState(true);
  const [offers, setOffers] = useState(false);
  const [details, setDetails] = useState({ firstName: "", lastName: "", phone: "", email: "", note: "" });
  const [agreed, setAgreed] = useState(false);
  // The policy for this visit (from the server), and the card entered.
  const [loaded, setLoaded] = useState<{ key: string; terms: TermsResult } | null>(null);
  const [cardRef, setCardRef] = useState("");
  // The promotion for the visit: a code they applied, or the special for
  // their time (from the server).
  const [promo, setPromo] = useState<{ key: string; code: string | null; result: PromotionResult } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blockedServices, setBlockedServices] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const honeypot = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const services = useMemo(() => new Map(site.services.map((s) => [s.id, s])), [site.services]);
  const selected = serviceIds.map((id) => services.get(id)!);
  const able = site.stylists.filter((s) => serviceIds.every((id) => id in s.prices));
  const stylist = staffId ? site.stylists.find((s) => s.id === staffId) ?? null : null;
  const totalMinutes = selected.reduce((sum, s) => sum + s.minutes, 0);

  // What the visit costs: with the chosen stylist, or the range across who
  // could do each service.
  const priceRange = (ids: string[], who: SiteStylist[] | null) => {
    if (who && who.length === 1) return [ids.reduce((sum, id) => sum + who[0].prices[id], 0)];
    const lows = ids.map((id) => Math.min(...site.stylists.filter((s) => id in s.prices).map((s) => s.prices[id])));
    const highs = ids.map((id) => Math.max(...site.stylists.filter((s) => id in s.prices).map((s) => s.prices[id])));
    return [lows.reduce((a, b) => a + b, 0), highs.reduce((a, b) => a + b, 0)];
  };
  const visitStylists = slot && staffId === null ? slot.staffIds.map((id) => site.stylists.find((s) => s.id === id)!) : stylist ? [stylist] : null;
  const prices = serviceIds.length ? priceRange(serviceIds, visitStylists?.length === 1 ? visitStylists : stylist ? [stylist] : null) : [];
  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) > STEPS.indexOf(step) ? 1 : -1);
    setNotice(null);
    // Agreeing is for the policy as shown for this exact visit.
    if (next === "confirm") setAgreed(false);
    setStep(next);
  };

  // Move focus to the new step's title, for keyboards and screen readers,
  // and bring it into view.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [step]);

  // The policy is worked out for this exact visit when it's reviewed.
  const review = identity.phase === "done" && slot && step === "confirm" ? `${identity.session}|${serviceIds.join(",")}|${staffId}|${slot.date}|${slot.minute}` : null;
  useEffect(() => {
    if (!review || identity.phase !== "done" || !slot) return;
    let live = true;
    reviewTerms(site.business.slug, identity.session, serviceIds, staffId ?? null, slot.date, slot.minute).then((t) => {
      if (!live) return;
      setLoaded({ key: review, terms: t });
      if (t.ok) setCardRef(t.cards[0]?.ref ?? "");
    });
    reviewPromotion(site.business.slug, identity.session, serviceIds, staffId ?? null, slot.date, slot.minute, null).then((result) => live && setPromo({ key: review, code: null, result }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `review` holds everything it depends on.
  }, [review]);
  const terms = loaded && loaded.key === review ? loaded.terms : null;
  const needsCard = terms?.ok === true && terms.cardNeeded && !terms.cardOnFile;
  const visitPromo = promo && promo.key === review ? promo : null;
  const applyCode = async (code: string | null) => {
    if (identity.phase !== "done" || !slot || !review) return null;
    const result = await reviewPromotion(site.business.slug, identity.session, serviceIds, staffId ?? null, slot.date, slot.minute, code);
    // A code that can't be used leaves what was there.
    if (result.ok) setPromo({ key: review, code, result });
    return result.ok ? null : result.message;
  };

  const toggleService = (id: string) => {
    setBlockedServices([]);
    setSlot(null);
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_SERVICES ? ids : [...ids, id]));
    // A stylist who doesn't do the new set is no longer a choice.
    setStaffId(undefined);
  };

  const submit = () => {
    if (identity.phase !== "done" || !slot) return;
    startTransition(async () => {
      const result = await book(site.business.slug, {
        session: identity.session,
        serviceIds,
        staffId: staffId ?? null,
        date: slot.date,
        minute: slot.minute,
        ...(identity.known ? {} : details),
        note: details.note,
        agreed,
        honeypot: honeypot.current?.value ?? "",
        source,
        cardRef: needsCard ? cardRef : undefined,
        remember: !signedIn && remember,
        appointmentTexts,
        offers,
        promoCode: visitPromo?.code ?? undefined,
      });
      if (result.ok) {
        router.push(result.manageUrl);
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
    (step === "services" && serviceIds.length > 0) ||
    (step === "stylist" && staffId !== undefined) ||
    (step === "time" && slot !== null) ||
    (step === "details" && identity.phase === "done" && (identity.known || (site.settings.allowNewClients && detailsComplete(details, identity.channel))));

  return (
    <div className="flex flex-1 flex-col" data-testid="booking-flow">
      {step === "services" && (
        <div className="mb-6">
          <p className="font-serif text-3xl leading-tight font-semibold tracking-tight text-ink">Book online</p>
          {site.settings.welcome && <p className="mt-2 text-ink-muted">{site.settings.welcome}</p>}
        </div>
      )}

      <nav aria-label="Booking steps" className="mb-4 flex items-center gap-3">
        {index > 0 && (
          <button
            type="button"
            onClick={() => go(STEPS[index - 1])}
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span aria-hidden>←</span> Back
          </button>
        )}
        <ol className="ml-auto flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? "step" : undefined}
              className={`h-1.5 rounded-full transition-[width,background-color] duration-(--motion-base) ${i === index ? "w-6 bg-(--accent)" : i < index ? "w-3 bg-(--accent-line)" : "w-3 bg-line-strong"}`}
            >
              <span className="sr-only">{STEP_TITLES[s]}</span>
            </li>
          ))}
        </ol>
      </nav>

      <section
        key={step}
        aria-labelledby="step-title"
        className="flex flex-1 animate-step-in flex-col"
        style={{ "--step-from": `${direction * 16}px` } as React.CSSProperties}
      >
        <h1 id="step-title" ref={heading} tabIndex={-1} className="mb-4 font-serif text-2xl font-semibold tracking-tight text-ink focus:outline-none">
          {STEP_TITLES[step]}
        </h1>

        {notice && (
          <p role="alert" className="mb-4 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
            {notice}
          </p>
        )}

        {step === "services" && (
          <ServicesStep
            site={site}
            selected={serviceIds}
            blocked={blockedServices}
            onToggle={toggleService}
            onConsultation={() => {
              const id = site.settings.consultationServiceId!;
              setBlockedServices([]);
              setSlot(null);
              setStaffId(undefined);
              setServiceIds((ids) => (ids.includes(id) ? ids : [...ids, id].slice(-MAX_SERVICES)));
            }}
          />
        )}

        {step === "stylist" && (
          <StylistStep site={site} serviceIds={serviceIds} able={able} chosen={staffId} priceRange={priceRange} onChoose={(id) => (setStaffId(id), setSlot(null))} />
        )}

        {step === "time" && (
          <TimeStep
            key={`${serviceIds.join(",")}:${staffId}`}
            slug={site.business.slug}
            today={today}
            serviceIds={serviceIds}
            staffId={staffId ?? null}
            stylists={site.stylists}
            slot={slot}
            onPick={setSlot}
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

        {step === "confirm" && slot && (
          <ConfirmStep
            site={site}
            selected={selected}
            slot={slot}
            stylists={visitStylists ?? []}
            noPreference={staffId === null}
            total={prices}
            terms={terms}
            cardRef={cardRef}
            setCardRef={setCardRef}
            agreed={agreed}
            appointmentTexts={appointmentTexts}
            setAppointmentTexts={setAppointmentTexts}
            offers={offers}
            setOffers={setOffers}
            setAgreed={setAgreed}
            promo={visitPromo}
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

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {serviceIds.length > 0 && step !== "confirm" && (
          <p className="mb-2 flex justify-between gap-3 text-sm text-ink-muted" data-testid="summary">
            <span>
              {serviceIds.length} {serviceIds.length === 1 ? "service" : "services"} · {formatMinutes(totalMinutes)}
              {slot && ` · ${longDate(slot.date, true)}, ${formatMinute(slot.minute)}`}
            </span>
            <span className="font-semibold text-ink tabular-nums">{formatPriceRange(prices)}</span>
          </p>
        )}
        {step === "confirm" ? (
          <button type="button" className={primaryButton} disabled={!agreed || pending || terms?.ok !== true} onClick={submit}>
            {pending ? "Booking…" : terms?.ok && terms.depositCents > 0 ? `Pay ${formatPrice(terms.depositCents)} deposit and book` : "Book appointment"}
          </button>
        ) : (
          // On the details step, the code form has its own button until it's done.
          (step !== "details" || identity.phase === "done") && (
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
  blocked,
  onToggle,
  onConsultation,
}: {
  site: BookingSite;
  selected: string[];
  blocked: string[];
  onToggle: (id: string) => void;
  onConsultation: () => void;
}) {
  const categories = [...new Set(site.services.map((s) => s.category))];
  const range = (s: SiteService) => formatPriceRange(site.stylists.filter((st) => s.id in st.prices).map((st) => st.prices[s.id]));
  return (
    <div className="flex flex-col gap-7">
      {categories.map((category) => (
        <section key={category} aria-labelledby={`cat-${category}`}>
          <h2 id={`cat-${category}`} className="mb-2 text-xs font-semibold tracking-wider text-ink-muted uppercase">
            {category}
          </h2>
          <ul className="flex flex-col gap-2">
            {site.services
              .filter((s) => s.category === category)
              .map((s) => {
                const on = selected.includes(s.id);
                const deposit = describeDeposit(s.depositKind, s.depositAmount);
                if (s.mode === "consultation") {
                  return (
                    <li key={s.id} className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3">
                      <p className="font-semibold text-ink">{s.name}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">We&rsquo;ll start with a consultation to plan this together.</p>
                      {site.settings.consultationServiceId ? (
                        <button
                          type="button"
                          onClick={onConsultation}
                          className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-(--accent-line) px-4 text-sm font-semibold text-ink hover:bg-(--accent-soft) focus-visible:outline-2 focus-visible:outline-focus"
                        >
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
                    <button type="button" aria-pressed={on} onClick={() => onToggle(s.id)} className={`${choiceClass} ${on ? chosen : notChosen}`}>
                      <span
                        aria-hidden
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs text-white transition-colors duration-(--motion-fast) ${on ? "border-(--accent) bg-(--accent)" : "border-line-strong"}`}
                      >
                        {on && "✓"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink">{s.name}</span>
                        <span className="block text-sm text-ink-muted">
                          {formatMinutes(s.minutes)}
                          {deposit && ` · ${deposit}`}
                        </span>
                        {s.requiresPatchTest && (
                          <span className={`mt-0.5 block text-xs ${blocked.includes(s.id) ? "font-semibold text-danger" : "text-ink-muted"}`}>
                            Needs a patch test on file
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{range(s)}</span>
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
          <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) font-serif text-xl text-ink">
            ✦
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">No preference</span>
            <span className="block text-sm text-ink-muted">The first stylist free at your time</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{formatPriceRange(priceRange(serviceIds, null))}</span>
        </button>
      </li>
      {able.map((s) => (
        <li key={s.id}>
          <button type="button" aria-pressed={current === s.id} onClick={() => onChoose(s.id)} className={`${choiceClass} ${current === s.id ? chosen : notChosen}`}>
            <Avatar name={s.displayName} color={s.color} level={s.level} photoUrl={s.photoUrl} size="lg" />
            <span className="min-w-0 flex-1 pl-1">
              <span className="block font-semibold text-ink">{s.displayName}</span>
              {s.level && <span className="block text-sm text-ink-muted">{LEVEL_LABELS[s.level]} stylist</span>}
            </span>
            <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{formatPrice(serviceIds.reduce((sum, id) => sum + s.prices[id], 0))}</span>
          </button>
        </li>
      ))}
      {able.length === 0 && (
        <li className="text-sm text-ink-muted">No one stylist does all of these, so we&rsquo;ll match each service with someone who does.</li>
      )}
      {site.stylists.length > 0 && <li className="sr-only">Prices are for everything you chose.</li>}
    </ul>
  );
}

function TimeStep({
  slug,
  today,
  serviceIds,
  staffId,
  stylists,
  slot,
  onPick,
}: {
  slug: string;
  today: LocalDate;
  serviceIds: string[];
  staffId: string | null;
  stylists: SiteStylist[];
  slot: { date: LocalDate; minute: number } | null;
  onPick: (slot: { date: LocalDate; minute: number; staffIds: string[] }) => void;
}) {
  const [days, setDays] = useState<DayTimes[] | null>(null);
  const [lastDay, setLastDay] = useState<LocalDate | null>(null);
  const [date, setDate] = useState<LocalDate | null>(slot?.date ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const load = (from: LocalDate) =>
    startLoading(async () => {
      const result = await findTimes(slug, serviceIds, staffId, from);
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
    load(today);
    // Loads once for these services and stylist (the step remounts when they change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const day = days?.find((d) => d.date === date);
  const nextFrom = days?.length ? days.at(-1)!.date : null;
  const name = (id: string) => stylists.find((s) => s.id === id)?.firstName ?? "";

  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!days) return <p className="text-ink-muted" aria-busy="true">Finding times…</p>;

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
        <p className="rounded-xl bg-(--accent-soft) px-4 py-3 text-sm text-ink" data-testid="specials-note">
          Last-minute specials: times marked with a discount have it taken off when you pay.
        </p>
      )}
      {day && (
        <div>
          <h2 className="mb-3 font-semibold text-ink">{longDate(day.date)}</h2>
          {day.times.length ? (
            <TimeGrid
              times={day.times}
              selected={slot && slot.date === day.date ? slot.minute : null}
              onPick={(t) => onPick({ date: day.date, minute: t.minute, staffIds: t.staffIds })}
              label={staffId === null ? (t) => t.staffIds.map(name).join(" & ") : undefined}
              badge={(t) => t.special}
            />
          ) : (
            <p className="rounded-xl bg-sunken px-4 py-6 text-center text-ink-muted">No times this day. Try another date.</p>
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
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      const result = await requestCode(site.business.slug, channel, value, honeypot.current?.value ?? "");
      if (!result.ok) return setError(result.message);
      setError(null);
      setCode("");
      setIdentity({ phase: "code", verificationId: result.verificationId, sentTo: result.sentTo });
    });

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
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="text-ink-muted">We&rsquo;ll send you a code to confirm it&rsquo;s you. Booked with us before? We&rsquo;ll find your details.</p>
          <div role="radiogroup" aria-label="Send the code by" className="grid grid-cols-2 gap-2 rounded-xl bg-sunken p-1">
            {(["sms", "email"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                onClick={() => (setChannel(c), setValue(""), setError(null))}
                className={`min-h-11 rounded-lg text-sm font-semibold transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-focus ${channel === c ? "bg-surface text-ink shadow-card" : "text-ink-muted"}`}
              >
                {c === "sms" ? "Text me" : "Email me"}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            {channel === "sms" ? "Mobile number" : "Email"}
            <input
              className={inputClass}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type={channel === "sms" ? "tel" : "email"}
              inputMode={channel === "sms" ? "tel" : "email"}
              autoComplete={channel === "sms" ? "tel" : "email"}
              placeholder={channel === "sms" ? "(312) 555-0123" : "you@example.com"}
              required
            />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" className={primaryButton} disabled={pending || !value.trim()}>
            {pending ? "Sending…" : "Send code"}
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
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button type="submit" className={primaryButton} disabled={pending || code.length !== 6}>
            {pending ? "Checking…" : "Confirm"}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className="min-h-11 font-semibold text-link hover:text-link-hover" onClick={send} disabled={pending}>
              Send a new code
            </button>
            <button type="button" className="min-h-11 font-semibold text-link hover:text-link-hover" onClick={() => (setIdentity({ phase: "enter" }), setError(null))}>
              Use a different {channel === "sms" ? "number" : "email"}
            </button>
          </div>
        </form>
      )}

      {identity.phase === "done" && identity.known && (
        <p className="rounded-xl bg-(--accent-soft) px-4 py-4 text-ink" data-testid="welcome-back">
          Welcome back, <span className="font-semibold">{identity.firstName}</span>. You&rsquo;re all set.
        </p>
      )}

      {identity.phase === "done" && !identity.known && !site.settings.allowNewClients && (
        <p role="alert" className="rounded-xl bg-sunken px-4 py-4 text-ink">
          We couldn&rsquo;t find you in our records, and new clients book by phone. Please call {site.location.phone ?? "the salon"}.
        </p>
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
  selected,
  slot,
  stylists,
  noPreference,
  total,
  terms,
  cardRef,
  setCardRef,
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
  selected: SiteService[];
  slot: { date: LocalDate; minute: number };
  stylists: SiteStylist[];
  noPreference: boolean;
  total: number[];
  terms: TermsResult | null;
  cardRef: string;
  setCardRef: (v: string) => void;
  agreed: boolean;
  appointmentTexts: boolean;
  setAppointmentTexts: (on: boolean) => void;
  offers: boolean;
  setOffers: (on: boolean) => void;
  setAgreed: (v: boolean) => void;
  promo: { code: string | null; result: PromotionResult } | null;
  onCode: (code: string | null) => Promise<string | null>;
}) {
  const single = stylists.length === 1 ? stylists[0] : null;
  const card = terms?.ok && terms.cardNeeded;
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="border-b border-line bg-(--accent-soft) px-4 py-4">
          <p className="font-serif text-xl font-semibold text-ink">{longDate(slot.date)}</p>
          <p className="text-ink-muted">
            {formatMinute(slot.minute)} · {site.location.name}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {selected.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-semibold text-ink">{s.name}</span>
                <span className="text-sm text-ink-muted">
                  {formatMinutes(s.minutes)}
                  {single && ` · with ${single.firstName}`}
                </span>
              </span>
              {single && <span className="text-sm font-semibold text-ink tabular-nums">{formatPrice(single.prices[s.id])}</span>}
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line px-4 py-3 font-semibold text-ink">
          <span>Total</span>
          <span className="tabular-nums">{formatPriceRange(total)}</span>
        </div>
        {!single && stylists.length > 1 && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">With {stylists.map((s) => s.firstName).join(" and ")}.</p>
        )}
        {noPreference && (
          <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">
            {stylists.length ? "If they're booked by the time you confirm, we'll match you with another stylist who's free." : "We'll match you with a stylist who's free."}
          </p>
        )}
      </div>

      <PromoCode promo={promo} onCode={onCode} />

      {terms === null ? (
        <p className="text-sm text-ink-muted" aria-busy="true">
          Getting the cancellation policy…
        </p>
      ) : !terms.ok ? (
        <p role="alert" className="font-medium text-danger">
          {terms.message}
        </p>
      ) : (
        <>
          <section aria-labelledby="policy-heading" className="rounded-xl border border-line bg-surface px-4 py-4" data-testid="policy">
            <h2 id="policy-heading" className="font-semibold text-ink">
              Cancellation policy
            </h2>
            <div className="mt-1 flex flex-col gap-1.5 text-sm text-ink-muted">
              {terms.lines.map((line) => (
                <p key={line} className="whitespace-pre-line">
                  {line}
                </p>
              ))}
            </div>
          </section>

          {terms.depositCents > 0 && (
            <div className="rounded-xl border border-line bg-surface px-4 py-4" data-testid="deposit">
              <p className="flex justify-between font-semibold text-ink">
                <span>Deposit, paid now</span>
                <span className="tabular-nums">{formatPrice(terms.depositCents)}</span>
              </p>
              <p className="mt-1 text-sm text-ink-muted">It comes off your bill at the visit.</p>
            </div>
          )}

          {card && (
            <section aria-labelledby="card-heading" className="rounded-xl border border-line bg-surface px-4 py-4">
              <h2 id="card-heading" className="font-semibold text-ink">
                {terms.cardOnFile ? "Your card on file" : "Card to hold your booking"}
              </h2>
              {terms.cardOnFile ? (
                <p className="mt-1 text-sm text-ink-muted">{terms.cardOnFile}</p>
              ) : terms.testMode ? (
                <label className="mt-2 flex flex-col gap-1 text-sm font-medium text-ink">
                  Card (test mode: nothing is charged)
                  <select value={cardRef} onChange={(e) => setCardRef(e.target.value)} className={inputClass}>
                    {terms.cards.map((c) => (
                      <option key={c.ref} value={c.ref}>
                        {c.label} ({c.outcome.toLowerCase()})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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

// The promotion on the visit (a special for the time, or their code), and
// a place to enter a promo code. It comes off when they pay.
function PromoCode({ promo, onCode }: { promo: { code: string | null; result: PromotionResult } | null; onCode: (code: string | null) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const applied = promo?.result.ok ? promo.result.promo : null;
  return (
    <div className="flex flex-col gap-2">
      {applied && (
        <div className="rounded-xl border border-(--accent-line) bg-(--accent-soft) px-4 py-3" data-testid="online-promotion">
          <p className="flex justify-between gap-3 font-semibold text-ink">
            <span>
              {applied.name}: {applied.text}
            </span>
            <span className="tabular-nums">about −{formatPrice(applied.discountCents)}</span>
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">Taken off when you pay at your visit.</p>
          {promo?.code && (
            <button type="button" className="mt-1 text-sm font-medium text-ink underline" onClick={() => start(async () => void (await onCode(null)))}>
              Remove code
            </button>
          )}
        </div>
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
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Promo code
              <span className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} uppercase`} autoCapitalize="characters" autoComplete="off" maxLength={24} />
                <button type="submit" disabled={pending || !code.trim()} className="min-h-11 shrink-0 rounded-xl border border-line-strong px-4 font-semibold text-ink disabled:opacity-60">
                  Apply
                </button>
              </span>
            </label>
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
          </form>
        ) : (
          <button type="button" className="self-start text-sm font-medium text-ink underline" onClick={() => setOpen(true)}>
            Have a promo code?
          </button>
        ))}
    </div>
  );
}
