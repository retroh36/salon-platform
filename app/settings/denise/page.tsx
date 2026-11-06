import type { Metadata } from "next";
import { Suspense } from "react";
import { serif } from "@/app/serif";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { DenisePose } from "@/components/denise";
import { Badge, PageHeader } from "@/components/ui/page";
import { ChartIcon, CheckIcon, ClipboardIcon, SendIcon, ShieldIcon, UndoIcon } from "@/components/ui/icons";
import { getCurrentStaff } from "@/lib/auth";
import { isFrontOfHouse } from "@/lib/staff";
import { SettingsNav } from "../settings-nav";
import { BookingExample, BriefExample, FixExample, GrowExample, LearnExample, QuestionsExample, ReorderExample } from "./examples";
import { TryIt } from "./try-it";

export const metadata: Metadata = { title: "Meet Denise" };

export default function MeetDenisePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <MeetDenise />
    </Suspense>
  );
}

// What Denise does, for everyone on the team (Settings → Denise, and "What
// can Denise do?" in her header). Content only: every claim here is
// something Maestra does today, and nothing on the page calls her AI
// service. Her serif headline and her drawings make it plainly her page.
async function MeetDenise() {
  const { staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  const frontOfHouse = isFrontOfHouse(me.role);
  const questions = frontOfHouse
    ? ["Who's cancelled late this month?", "How do I sell a gift card?", "Who's working this afternoon?"]
    : ["Which of my regulars are due back?", "How long do I usually take for a balayage?", "How much PTO do I have?"];

  return (
    <AppShell section="settings" me={me}>
      <PageHeader title="Meet Denise" description="What Denise does for the salon, where you'll see her, and the rules she works by." />
      <SettingsNav current="denise" me={me} />

      <div className={`${serif.variable} @container flex flex-col`}>
        {/* 1. Who she is. */}
        <section aria-labelledby="denise-intro" className="flex flex-col-reverse items-start gap-6 rounded-xl border border-denise-100 bg-denise-50 p-6 @2xl:flex-row @2xl:items-center @2xl:gap-10 @2xl:p-10" data-testid="meet-denise-intro">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-xs font-semibold tracking-wide text-denise-700 uppercase">Meet Denise</p>
            <h2 id="denise-intro" className="font-serif text-display-lg font-semibold text-balance text-denise-900">
              Denise is your salon&rsquo;s brain.
            </h2>
            <p className="max-w-[60ch] text-base text-ink">
              She watches the whole salon all day: the calendar, the team, your clients and your stock. She spots problems before they happen, works out the smallest fix and tells you why. Your team approves everything she suggests.
            </p>
          </div>
          <DenisePose className="w-24 @2xl:w-36" />
        </section>

        <Feature
          id="fixes"
          eyebrow="Fixes the day live"
          title="When the day slips, she has a fix ready"
          text="A stylist running late, a color running over, someone calling out sick: Denise looks over the rest of the day and finds the fix that moves the fewest clients by the smallest amount."
          points={[
            "She says why it works, and shows where everyone would move on the calendar before you choose.",
            "One tap to apply it, and one tap to undo it.",
            "For a stylist out all day, Mark out gives a plan for every client: move, reschedule or call.",
          ]}
          who="The front desk, managers and owners apply fixes."
          example={<FixExample />}
        />

        <Feature
          id="brief"
          eyebrow="Sees problems first"
          title="A morning brief before the doors open"
          text="Every day starts with Denise's brief at the top of the Dashboard: what might go wrong today and who to look out for, each one a tap away."
          points={[
            "Visits likely to run over, with fixes already waiting.",
            "Clients who might not show, and regulars due back with nothing booked.",
            "Stock running low for today's services, and clients coming in with package uses or gift card money.",
            "Events coming up with something to sort out. Beside the brief, the Dashboard lists payments that didn't go through.",
          ]}
          who="Stylists get their own day: their clients, their notes and their numbers."
          example={<BriefExample />}
          pose="think"
        />

        <Feature
          id="learns"
          eyebrow="Learns your salon"
          title="She knows how your salon really runs"
          text="Every visit teaches her something. She learns how long each stylist really takes for each service, and each client's habits."
          points={[
            "Real service times per stylist, from the times they tap or from check-in to checkout, trusted once there are enough visits.",
            "How often each client comes in, who they see, what they book and when they're due back.",
            "When a service is usually booked too short, she suggests a better length, which owners and managers accept on Durations.",
          ]}
          example={<LearnExample />}
        />

        <Feature
          id="ordering"
          eyebrow="Handles ordering"
          title="Reorders drafted from what's booked"
          text="Denise looks at what the next two weeks of bookings will use, including each client's color formula, against what's on the shelf and on order."
          points={["When something will run short, she drafts a reorder, one per supplier.", "A manager reviews it and turns it into a draft order. Nothing is ordered by itself."]}
          who="Owners and managers approve reorders."
          example={<ReorderExample />}
        />

        <Feature
          id="booking"
          eyebrow="Books by typing"
          title="Type the request the way the client said it"
          text="Type “Maria, cut with Gil Thursday morning” into Denise's box and she finds the client, then the best times by the booking rules, with the reason for each."
          points={[
            "She weighs the client's usual stylist, day and time, and keeps the book snug.",
            "When nothing fits, she offers another day, a stylist at the same level, or the waitlist.",
            "One tap to book, after a quick check of the details and the cancellation policy.",
          ]}
          who="For the front desk, managers and owners."
          example={<BookingExample />}
        />

        <Feature
          id="questions"
          eyebrow="Answers questions"
          title="Ask about the salon, or about Maestra"
          text="Ask Denise anything about your business, and she answers from your own data. Ask how to do something in Maestra, and she answers from the help guide with a button to the right screen."
          points={["“Who's cancelled late this month?” “Who's working this afternoon?” “Who has unused packages?”", "“How much PTO do I have?” “Who's off next week?” “How many sick days has Nola taken this year?”", "“How do I sell a gift card?” “How do I ask for time off?”", "Each person only gets answers their role is allowed to see: their own time off and PTO, or everyone's for owners and managers."]}
          example={<QuestionsExample />}
        />

        <Feature
          id="grows"
          eyebrow="Grows the book"
          title="She helps fill the chairs"
          text="Open time is money. Denise points out who could fill it, and keeps the team on track."
          points={[
            "When time opens up, she matches it to clients on the waitlist, people who asked for that stylist first.",
            "For gaps of an hour or more, she suggests regulars who are due back for a last-minute special.",
            "Stylists get a daily or weekly check-in on their goals, with ideas from their own book.",
            "She notices trends, like a service getting faster or an automation worth turning on.",
          ]}
          who="Staff choose who to book or contact, and send it themselves."
          example={<GrowExample />}
        />

        {/* 9. Trust and guardrails. */}
        <section aria-labelledby="denise-trust" className="flex flex-col gap-6 border-t border-line py-10" data-testid="meet-denise-section">
          <div className="flex max-w-[65ch] flex-col gap-2">
            <p className="text-xs font-semibold tracking-wide text-denise-700 uppercase">Trust and guardrails</p>
            <h2 id="denise-trust" className="text-xl font-semibold text-balance text-ink">
              She suggests. Your team decides.
            </h2>
          </div>
          <ul className="grid gap-x-10 gap-y-5 @2xl:grid-cols-2">
            {GUARDRAILS.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-denise-50 text-denise-700">
                  <Icon className="size-4.5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="font-semibold text-ink">{title}</span>
                  <span className="text-ink-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4 text-sm @2xl:flex-row @2xl:items-center @2xl:gap-3" data-testid="coming-soon">
            <Badge tone="neutral">Coming soon</Badge>
            <p className="text-ink-muted">Texts and emails reaching clients (they wait in the outbox for now), reminders before visits, and live card payments.</p>
          </div>
        </section>

        {/* 10. Try it. */}
        <section aria-labelledby="denise-try" className="grid items-center gap-6 border-t border-line py-10 @3xl:grid-cols-[auto_minmax(0,1fr)] @3xl:gap-10" data-testid="meet-denise-try">
          <DenisePose pose="point" className="hidden w-32 @3xl:block" />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold tracking-wide text-denise-700 uppercase">Try it</p>
              <h2 id="denise-try" className="text-xl font-semibold text-balance text-ink">
                Ask her something
              </h2>
              <p className="max-w-[65ch] text-sm text-ink-muted">Tap a question to open Denise with it typed in, then send it. You can also open her any time with her face in the corner, or ⌘K (Ctrl+K).</p>
            </div>
            <TryIt questions={questions} />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

const GUARDRAILS = [
  { Icon: CheckIcon, title: "Staff approve every change", text: "Denise proposes; someone on the team applies it. She never moves a visit or orders stock by herself." },
  { Icon: UndoIcon, title: "Everything is logged and undoable", text: "Each suggestion is kept with its reason, who applied it and when, with Undo to put things back as they were." },
  { Icon: ChartIcon, title: "Every number is from your real data", text: "Maestra works out every figure from your own bookings, sales and stock. Denise explains them; she never makes one up." },
  { Icon: SendIcon, title: "She never messages clients", text: "Messages to clients are written and sent by your team, or are the salon's fixed confirmations and receipts." },
  { Icon: ShieldIcon, title: "Your salon's data stays private", text: "Each salon only ever sees its own data, and Denise's AI service gets first names only: no phone numbers, notes or payment details." },
  { Icon: ClipboardIcon, title: "Each role sees its own", text: "Stylists see their own book and no salon money; the front desk sees no payroll." },
];

// One of the sections: what she does on the left, an example of it from
// the demo on the right (stacked on a narrow screen).
function Feature({
  id,
  eyebrow,
  title,
  text,
  points,
  who,
  example,
  pose,
}: {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  who?: string;
  example: React.ReactNode;
  pose?: "think";
}) {
  return (
    <section aria-labelledby={`denise-${id}`} className={`grid gap-6 py-10 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] @3xl:gap-10 ${id === "fixes" ? "" : "border-t border-line"}`} data-testid="meet-denise-section">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-denise-700 uppercase">{eyebrow}</p>
        <h2 id={`denise-${id}`} className="text-xl font-semibold text-balance text-ink">
          {title}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-muted">{text}</p>
        <ul className="flex max-w-[65ch] flex-col gap-2 text-sm text-ink">
          {points.map((p) => (
            <li key={p} className="flex gap-2">
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-denise-700" />
              <span className="min-w-0">{p}</span>
            </li>
          ))}
        </ul>
        {who && <p className="text-13 text-ink-subtle">{who}</p>}
        {pose && <DenisePose pose={pose} className="mt-2 hidden w-28 @3xl:block" />}
      </div>
      {example}
    </section>
  );
}
