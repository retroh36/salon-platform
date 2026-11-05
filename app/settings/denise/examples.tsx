import { DeniseFace } from "@/components/denise";
import { buttonClass } from "@/components/ui/button";
import { CheckCircleIcon, CheckIcon, ClockIcon, UndoIcon } from "@/components/ui/icons";

// Meet Denise's examples: her real cards as they look on the calendar, the
// Dashboard and in her chat, with Maple & Ash's demo team and clients. Only
// pictures: the buttons in them are drawn, not buttons, so nothing here
// does anything or calls her AI service.

const card = "flex gap-2.5 rounded-lg border border-denise-200 bg-surface p-4 text-sm";
// A button as it looks, not one you can press.
const drawn = (variant: "primary" | "secondary" | "quiet", extra = "") => `${buttonClass(variant, "sm", extra)} pointer-events-none`;

export function Example({ label = "Example from the demo salon", children }: { label?: string; children: React.ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-testid="denise-example">
      <figcaption className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{label}</figcaption>
      <div className="flex flex-col gap-3">{children}</div>
    </figure>
  );
}

// Her fix card, then what applying it leaves: the moved client's message
// waiting for staff, and Undo.
export function FixExample() {
  return (
    <Example>
      <section aria-label="A fix from Denise" className={card}>
        <DeniseFace size={24} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-ink">
            <strong className="font-semibold text-denise-900">Bridget&rsquo;s running 20 min late.</strong> I found a fix that only moves one client: Maria 11am → 11:20am with Lois. Want me to apply it?
          </p>
          <p className="text-ink-muted">
            <span className="font-semibold text-denise-700">Why it works: </span>
            Lois is free at 11:20 and does Maria&rsquo;s cut, so Bridget&rsquo;s afternoon stays as it is.
          </p>
          <div className="flex items-center gap-2">
            <span className={drawn("primary", "flex-1")}>
              <CheckIcon className="size-4" />
              Apply fix
            </span>
            <span className={drawn("quiet", "text-ink-muted")}>Dismiss</span>
          </div>
        </div>
      </section>
      <section aria-label="After applying it" className={card}>
        <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-denise-700" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
          <p className="text-ink">Moved Maria. Message ready to send.</p>
          <span className={drawn("secondary")}>
            <UndoIcon className="size-4" />
            Undo
          </span>
        </div>
      </section>
    </Example>
  );
}

// A few rows of the morning brief on the Dashboard.
export function BriefExample() {
  const rows: [string, string, string][] = [
    ["Risks today", "Gil usually takes about 25 min longer than booked for Balayage, so the 2pm is likely to run into the next client.", "Fixes are ready on the calendar."],
    ["Might not show", "Jayden Lee at 3:30pm", "Missed 40% of 5 visits. A reminder call could help."],
    ["Due back, nothing booked", "Grace Martin", "Every ~5 wk · 12 days overdue"],
    ["Coming in with credit", "Linda Park", "2 Blowouts left on a package"],
  ];
  return (
    <Example>
      <section aria-label="Denise's brief" className={card}>
        <DeniseFace size={24} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="font-semibold text-denise-900">Good morning. Here&rsquo;s what I&rsquo;d look at today.</p>
          <dl className="flex flex-col divide-y divide-line">
            {rows.map(([section, title, detail]) => (
              <div key={section} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <dt className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{section}</dt>
                <dd className="font-medium break-words text-ink">{title}</dd>
                <dd className="text-13 text-ink-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </Example>
  );
}

// What she's learned: a stylist's real time for a service, and a client's
// habits in one line.
export function LearnExample() {
  return (
    <Example>
      <section aria-label="A stylist's real time" className="rounded-lg border border-line bg-surface p-4 text-sm">
        <p className="font-semibold text-ink">Gil · Balayage</p>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
          <dt className="text-ink-muted">Booked as</dt>
          <dd className="text-right text-ink tabular-nums">2 hr 35 min</dd>
          <dt className="text-ink-muted">Usually takes</dt>
          <dd className="text-right font-semibold text-ink tabular-nums">2 hr 55 min</dd>
          <dt className="text-ink-muted">From</dt>
          <dd className="text-right text-ink tabular-nums">14 visits</dd>
        </dl>
        <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-denise-900">
          <DeniseFace size={20} className="mt-px" />
          <span>I&rsquo;d book it as 2 hr 55 min. One click on Durations, and Undo if it&rsquo;s not right.</span>
        </p>
      </section>
      <section aria-label="A client's habits" className="rounded-lg border border-line bg-surface p-4 text-sm">
        <p className="font-semibold text-ink">Maria Lopez</p>
        <p className="mt-1 flex items-start gap-2 text-ink-muted">
          <DeniseFace size={20} className="mt-px" />
          <span>Every ~6 weeks with Bridget · Balayage · usually Saturday mornings</span>
        </p>
      </section>
    </Example>
  );
}

// Her reorders card on the calendar.
export function ReorderExample() {
  const lines: [string, number, string][] = [
    ["Northline Beauty Supply", 6, "$412.80"],
    ["Lakeshore Salon Wholesale", 3, "$96.50"],
  ];
  return (
    <Example>
      <section aria-label="Reorders" className={card}>
        <DeniseFace size={24} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <p className="font-semibold text-denise-900">2 reorders ready to review</p>
          <ul className="flex w-full flex-col gap-1.5">
            {lines.map(([supplier, products, total]) => (
              <li key={supplier} className="flex items-baseline justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
                <span className="min-w-0">
                  <span className="block font-medium break-words text-ink">{supplier}</span>
                  <span className="block text-xs text-ink-muted">{products} products</span>
                </span>
                <span className="shrink-0 font-medium text-ink tabular-nums">{total}</span>
              </li>
            ))}
          </ul>
          <span className={drawn("secondary")}>Review on Inventory</span>
        </div>
      </section>
    </Example>
  );
}

// Booking by typing: the request, then her booking card's times.
export function BookingExample() {
  const times: [string, string, string, string][] = [
    ["Thu, Nov 12 · 9:30am", "Women's Cut & Style with Gil", "$85", "Maria's usual time of day, and right after Gil's first client."],
    ["Thu, Nov 12 · 11am", "Women's Cut & Style with Gil", "$85", "Still the morning, with a little room either side."],
    ["Thu, Nov 19 · 9am", "Women's Cut & Style with Gil", "$85", "The same morning a week later, if Thursday this week is tight."],
  ];
  return (
    <Example>
      <p className="max-w-[85%] self-end rounded-lg rounded-br-sm bg-navy-900 px-3 py-2 text-sm break-words text-white">Maria, cut with Gil Thursday morning</p>
      <section aria-label="Booking card" className={card}>
        <DeniseFace size={24} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-ink">Here are the best times for Maria Lopez.</p>
          <ol className="flex flex-col gap-2">
            {times.map(([when, what, price, reason]) => (
              <li key={when} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
                <p className="font-medium text-ink tabular-nums">{when}</p>
                <p className="text-ink">
                  {what} · <span className="tabular-nums">{price}</span>
                </p>
                <p className="text-denise-900">{reason}</p>
                <span className={drawn("secondary", "mt-1 self-start")}>Book</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </Example>
  );
}

function Question({ text }: { text: string }) {
  return <p className="max-w-[85%] self-end rounded-lg rounded-br-sm bg-navy-900 px-3 py-2 text-sm break-words text-white">{text}</p>;
}

function Answer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-full gap-2 text-sm">
      <DeniseFace size={24} className="mt-1 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 self-start rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 text-ink">{children}</div>
    </div>
  );
}

// Two questions: one about the salon, one about Maestra.
export function QuestionsExample() {
  return (
    <Example>
      <Question text="Who's cancelled late this month?" />
      <Answer>
        <p>Three clients have cancelled late this month: Aria, Mateo and Zoey. Mateo has done it twice since September. Want the rest?</p>
      </Answer>
      <Question text="How do I sell a gift card?" />
      <Answer>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Tap New sale at the top of the calendar.</li>
          <li>Under the lines, tap Gift card.</li>
          <li>Choose Physical card or Digital (email), and the amount.</li>
          <li>Tap Add to ticket, take payment, then Complete sale.</li>
        </ol>
        <span className={drawn("secondary", "self-start")}>Open new sale</span>
      </Answer>
    </Example>
  );
}

// Growing the book: an opening with a waitlist client who fits it, and a
// stylist's goal check-in.
export function GrowExample() {
  return (
    <Example>
      <section aria-label="An opening" className={card}>
        <DeniseFace size={24} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="font-semibold text-denise-900">A 45 min opening with Gil at 3pm fits 1 person on your waitlist.</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-medium text-ink">1. Ava Brooks</span>
              <span className="block text-xs text-ink-muted">Blowout · 3–3:45pm · asked for Gil</span>
            </span>
            <span className={drawn("secondary")}>Book</span>
          </div>
          <p className="text-xs text-ink-muted">You pick who to book; get in touch with them yourself.</p>
        </div>
      </section>
      <section aria-label="A goal check-in" className={card}>
        <DeniseFace size={24} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex items-center gap-1.5 font-semibold text-denise-900">
            <ClockIcon className="size-4 shrink-0 text-denise-700" />
            Service sales this month
          </p>
          <p className="text-ink">You&rsquo;re on pace — $6,200 of $9,000 with 9 working days left; you need $311.12/day and you have $2,400 already booked.</p>
        </div>
      </section>
    </Example>
  );
}
