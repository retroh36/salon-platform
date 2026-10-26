import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell, LoadingShell, NotLinked } from "@/components/app-shell";
import { DeniseFace, DenisePose } from "@/components/denise";
import { DeniseText } from "@/components/denise-text";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { Skeleton, toastActionClass } from "@/components/ui/feedback";
import { checkboxClass, Eyebrow, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CalendarIcon, MoreIcon, PlusIcon, SearchIcon, UndoIcon } from "@/components/ui/icons";
import { Alert, Badge, Card, EmptyState, nameLinkClass, PageHeader, pillClass, Section, textLinkClass, type Tone } from "@/components/ui/page";
import { StatusChip } from "@/components/ui/status-chip";
import { actionsClass, numClass, TableCard, tableClass, tdClass, theadClass, thClass, trClass } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/auth";
import { TabSamples } from "./samples";

export const metadata: Metadata = { title: "Style guide" };

// The owners' style guide (not in the sidebar): every shared component in
// its states, drawn by the components themselves, so it's always the app
// as it is (docs/brand.md).
export default function DesignPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <Design />
    </Suspense>
  );
}

const TYPE: [string, string, string][] = [
  ["text-2xl font-semibold tracking-[-0.015em]", "24px semibold", "Page title"],
  ["text-xl font-semibold", "20px semibold", "A big number, a dialog's lead"],
  ["text-base font-semibold", "16px semibold", "Section and card titles"],
  ["text-sm", "14px regular", "Body text, table cells, buttons"],
  ["text-13 font-medium", "13px medium", "Labels, notes"],
  ["text-xs", "12px regular", "Meta, tags, hints"],
];

const COLORS: [string, string[]][] = [
  ["Surfaces and text", ["canvas", "surface", "sunken", "line", "line-strong", "ink", "ink-muted", "ink-subtle"]],
  ["Brand", ["navy-900", "navy-800", "navy-700", "navy-200", "navy-100", "link", "focus"]],
  ["Status", ["success", "success-soft", "warning", "warning-soft", "danger", "danger-soft", "info", "info-soft", "neutral", "neutral-soft"]],
  ["Denise only", ["denise-50", "denise-100", "denise-200", "denise-500", "denise-600", "denise-700", "denise-900"]],
  ["Service colors", ["peach-fill", "lavender-fill", "sage-fill", "teal-fill", "sand-fill", "rose-fill", "sky-fill"]],
  ["Where the client is", ["visit-here", "visit-done", "visit-off"]],
];

const TONES: [Tone, string][] = [
  ["success", "Charged"],
  ["warning", "No card on file"],
  ["danger", "Card declined"],
  ["info", "Kept from deposit"],
  ["neutral", "Waived"],
];

const ROWS = [
  { name: "Sophia Taylor", date: "Sat, Oct 24", kind: "No-show", fee: "$25.00", tone: "neutral" as Tone, status: "Waived", note: "Car accident on the way", action: null },
  { name: "Carter Jackson", date: "Sat, Oct 24", kind: "No-show", fee: "$22.50", tone: "warning" as Tone, status: "No card on file", note: "", action: "Request card" },
  { name: "Violet Williams", date: "Thu, Oct 22", kind: "Late cancel", fee: "$22.50", tone: "success" as Tone, status: "Charged", note: "Visa …4242", action: "Refund" },
  { name: "Priyanka Moore", date: "Wed, Oct 21", kind: "No-show", fee: "$7.50", tone: "danger" as Tone, status: "Card declined", note: "", action: "Retry" },
];

const DENISE_ANSWER = `Three regulars are due back with nothing booked:
- **Ava**, every ~5 weeks, 9 days over
- **Mia**, every ~6 weeks, due now
- **Zoe**, every ~4 weeks, 3 days over

Want the rest?`;

async function Design() {
  const { staff: me } = await getCurrentStaff();
  if (!me) return <NotLinked />;
  if (me.role !== "owner") redirect("/dashboard");

  return (
    <AppShell section="settings" me={me} wide>
      <PageHeader
        title="Style guide"
        description="Every shared piece of Maestra, drawn by the components themselves. What they're for is in docs/brand.md."
        actions={
          <>
            <Button>Secondary</Button>
            <Button variant="primary">
              <PlusIcon className="size-4" />
              Primary
            </Button>
          </>
        }
      />

      <Section title="Type" description="Geist throughout. Hierarchy from weight and color, not size.">
        <Card flush>
          <ul className="divide-y divide-line">
            {TYPE.map(([cls, size, use]) => (
              <li key={size} className="grid items-baseline gap-2 px-4 py-3 sm:grid-cols-[1fr_10rem_14rem]">
                <span className={`${cls} text-ink`}>The quick brown fox</span>
                <span className="text-13 text-ink-muted tabular-nums">{size}</span>
                <span className="text-13 text-ink-subtle">{use}</span>
              </li>
            ))}
            <li className="grid items-baseline gap-2 px-4 py-3 sm:grid-cols-[1fr_10rem_14rem]">
              <span className="text-xl font-semibold text-ink tabular-nums">$1,794.00 · 110 of 172</span>
              <span className="text-13 text-ink-muted">Tabular figures</span>
              <span className="text-13 text-ink-subtle">Money and counts</span>
            </li>
            <li className="grid items-baseline gap-2 px-4 py-3 sm:grid-cols-[1fr_10rem_14rem]">
              <span className="font-mono text-sm text-ink">K7QM-3XRP-9TWD-FH2C</span>
              <span className="text-13 text-ink-muted">Geist Mono</span>
              <span className="text-13 text-ink-subtle">Codes only</span>
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="Color" description="Tokens only. Periwinkle is Denise's alone.">
        <div className="grid gap-6 md:grid-cols-2">
          {COLORS.map(([group, names]) => (
            <div key={group}>
              <Eyebrow className="mb-2">{group}</Eyebrow>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                {names.map((n) => (
                  <li key={n} className="flex items-center gap-2">
                    <span aria-hidden className="size-7 shrink-0 rounded-md border border-line" style={{ backgroundColor: `var(--color-${n})` }} />
                    <span className="truncate text-xs text-ink-muted">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" description="One primary per page or panel. 36px, 8px corners; 44px on a touchscreen.">
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Save changes</Button>
              <Button>Secondary</Button>
              <Button variant="quiet">Quiet</Button>
              <Button variant="danger-quiet">Cancel booking…</Button>
              <Button variant="danger">Yes, cancel it</Button>
              <IconButton label="More actions">
                <MoreIcon className="size-4" />
              </IconButton>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">
                <PlusIcon className="size-4" />
                New booking
              </Button>
              <Button>
                <CalendarIcon className="size-4" />
                Sat, October 24
              </Button>
              <Button variant="quiet">
                <UndoIcon className="size-4" />
                Undo
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs">xs · 32px, dense rows</Button>
              <Button size="md">md · 36px</Button>
              <Button size="lg">lg · 40px</Button>
              <span className={pillClass(true)}>Selected</span>
              <span className={pillClass(false)}>Not selected</span>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Fields">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Client name
              <input className={fieldClass} placeholder="First and last name" />
            </label>
            <label className={labelClass}>
              Service
              <select className={selectClass} defaultValue="cut">
                <option value="cut">Women&apos;s Cut &amp; Style</option>
                <option value="color">All-Over Color</option>
              </select>
            </label>
            <label className={labelClass}>
              Search
              <span className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
                <input type="search" className={`${fieldClass} pl-9`} placeholder="Name or phone" />
              </span>
            </label>
            <label className={labelClass}>
              Not valid
              <input className={fieldClass} aria-invalid defaultValue="ava@" />
              <span className="text-xs font-normal text-danger">Enter a full email address.</span>
            </label>
            <label className={labelClass}>
              Disabled
              <input className={fieldClass} disabled defaultValue="Maple & Ash" />
            </label>
            <label className={`${labelClass} sm:row-span-2`}>
              Notes
              <textarea className={`${fieldClass} min-h-24`} placeholder="Preferences, allergies…" />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className={checkboxClass} defaultChecked />
              Text them a reminder
            </label>
          </div>
        </Card>
      </Section>

      <Section title="Tabs and choices">
        <Card>
          <TabSamples />
        </Card>
      </Section>

      <Section title="Tags and statuses" description="A dot and a short label. Never a colored sentence.">
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {TONES.map(([tone, label]) => (
                <Badge key={tone} tone={tone}>
                  {label}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["booked", "confirmed", "checked_in", "completed", "no_show", "canceled"] as const).map((s) => (
                <StatusChip key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name="Bridget Callahan" level="master" />
              <Avatar name="Gil Navarro" level="senior" />
              <Avatar name="Hannah Novak" level="artisan" />
              <Avatar name="Sam Rivera" size="sm" />
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Stats" description="One bordered strip, divided into cells.">
        <dl className="grid overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-line">
          {[
            ["Recovered", "$572.50", "Fees + kept deposits"],
            ["Charged", "14", "$572.50"],
            ["Card on file", "64%", "110 of 172 upcoming"],
          ].map(([label, value, note]) => (
            <div key={label} className="border-t border-line px-4 py-3 first:border-t-0 sm:border-t-0">
              <dt className="text-13 text-ink-muted">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</dd>
              <dd className="text-xs text-ink-subtle">{note}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Tables" description="Records in aligned columns; money right-aligned; quiet actions at the end.">
        <TableCard>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Client</th>
                <th className={thClass}>Date</th>
                <th className={thClass}>Type</th>
                <th className={`${thClass} text-right`}>Fee</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.name} className={trClass}>
                  <td className={tdClass}>
                    <span className={nameLinkClass}>{r.name}</span>
                  </td>
                  <td className={`${tdClass} text-ink-muted`}>{r.date}</td>
                  <td className={`${tdClass} text-ink-muted`}>{r.kind}</td>
                  <td className={`${tdClass} ${numClass}`}>{r.fee}</td>
                  <td className={tdClass}>
                    <span className="flex items-center gap-2">
                      <Badge tone={r.tone}>{r.status}</Badge>
                      {r.note && <span className="text-13 text-ink-subtle">{r.note}</span>}
                    </span>
                  </td>
                  <td className={`${tdClass} ${actionsClass}`}>
                    {r.action && (
                      <Button size="xs" variant="quiet">
                        {r.action}
                      </Button>
                    )}
                    <IconButton label={`More for ${r.name}`} size="xs">
                      <MoreIcon className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </Section>

      <Section title="Cards and sections" description="One layer: groups are a title over the items; only the items are cards.">
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Card with a header" description="A 1px border, 8px corners, no shadow." actions={<Button size="xs" variant="quiet">Edit</Button>}>
            <p className="text-ink-muted">The body, 16px in from the edge.</p>
          </Card>
          <div>
            <div className="mb-3 flex items-baseline gap-1.5 border-b border-line pb-2">
              <span className="text-13 font-medium text-ink">Inquiry</span>
              <span className="text-13 text-ink-subtle tabular-nums">2</span>
            </div>
            <div className="flex flex-col gap-2">
              {[
                ["Linh's wedding", "Mon, Feb 22, 2027", "5 people · On location", ""],
                ["Alvarez quinceañera", "Wed, Mar 24, 2027 · 2pm", "4 people", "$972"],
              ].map(([title, when, who, total]) => (
                <div key={title} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                  <p className="font-semibold text-ink">{title}</p>
                  <p className="text-13 text-ink-muted">{when}</p>
                  <p className="mt-1 flex justify-between text-13 text-ink-muted">
                    {who}
                    <span className="text-ink tabular-nums">{total}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Alerts, empty and loading">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Alert>
              A payment didn&apos;t go through for the <strong className="font-semibold">Rossi wedding</strong>.
            </Alert>
            <Alert tone="warning">Card needed to hold this booking.</Alert>
            <Alert tone="success">Saved. The new prices apply to new bookings.</Alert>
            <Alert tone="info">Texts aren&apos;t connected yet: they go to the outbox.</Alert>
            <p className="text-sm">
              <span className={textLinkClass}>A text link</span> <span className="text-ink-muted">and</span> <span className={nameLinkClass}>a name</span>
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <Card flush>
              <EmptyState title="No events yet" action={<Button size="sm">New event</Button>}>
                Tap New event and describe it to Denise.
              </EmptyState>
            </Card>
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" style={{ animationDelay: "80ms" }} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Toast">
        <div className="flex">
          <div role="status" className="flex items-center gap-4 rounded-lg bg-navy-900 px-4 py-3 text-sm text-white shadow-lift">
            Ava Brown is checked in.
            <button type="button" className={toastActionClass}>
              Undo
            </button>
          </div>
        </div>
      </Section>

      <Section title="Denise" description="Periwinkle means Denise is speaking; nothing else uses it.">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex items-end gap-3">
            <DenisePose pose="wave" className="w-20" />
            <p className="mb-3 rounded-lg rounded-bl-sm bg-denise-50 px-3 py-2 font-medium text-denise-900">All clear today.</p>
          </div>
          <div className="flex flex-col gap-3">
            <p className="max-w-[85%] self-end rounded-lg rounded-br-sm bg-navy-900 px-3 py-2 text-white">Who&apos;s due back with nothing booked?</p>
            <div className="flex max-w-[92%] gap-2">
              <DeniseFace size={24} className="mt-1" />
              <DeniseText text={DENISE_ANSWER} className="rounded-lg rounded-tl-sm bg-denise-50 px-3 py-2 text-ink" />
            </div>
          </div>
          <section className="flex flex-col gap-3 rounded-lg border border-denise-200 bg-surface p-4 md:col-span-2">
            <div className="flex items-start gap-2.5">
              <DeniseFace size={28} />
              <p className="text-ink">
                <strong className="font-semibold text-denise-900">Gil&apos;s color is running 25 minutes over.</strong> I can move Stella to 12:35 with Gil, or to 12:10 with Hannah.
              </p>
            </div>
            <p className="text-ink-muted">
              <span className="font-semibold text-denise-700">Why it works: </span>
              Stella keeps her stylist and no one else moves.
            </p>
            <div className="flex gap-2">
              <Button variant="primary">Apply fix</Button>
              <Button variant="quiet">Dismiss</Button>
            </div>
          </section>
        </div>
      </Section>
    </AppShell>
  );
}
