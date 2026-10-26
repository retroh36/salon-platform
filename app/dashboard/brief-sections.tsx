"use client";

import Link from "next/link";
import { useState } from "react";
import { dismissDeniseItem } from "@/app/calendar/denise-actions";
import { CloseIcon } from "@/components/ui/icons";
import { AllClear } from "./all-clear";
import { briefItemKey, creditText, type BriefFacts } from "@/lib/denise/brief";

// Shown per section before "See all".
const TOP = 3;

// `label` names the row for its dismiss button when titles repeat.
type Row = { key: string; href: string; title: string; detail: string; label?: string };

// Denise's morning brief in sections: what might go wrong today and who to
// look out for, each item linking to the visit, client or product, and
// dismissable (it stays gone for the day).
export function BriefSections({ brief, today }: { brief: BriefFacts; today: string }) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const visit = (id: string | null) => (id ? `/calendar?open=${id}` : "/calendar?denise=1");
  const sections: { id: string; title: string; rows: Row[]; total: number; seeAll?: string; empty: string }[] = [
    {
      id: "risks",
      title: "Risks today",
      rows: brief.risks.map((r) => ({ key: briefItemKey.risk(r), href: visit(r.appointmentId), title: r.headline, detail: "Fixes are ready on the calendar." })),
      total: brief.risks.length,
      empty: "Nothing looks likely to run over.",
    },
    {
      id: "no-shows",
      title: "Might not show",
      rows: brief.likelyNoShows.map((n) => ({
        key: briefItemKey.noShow(n),
        href: visit(n.appointmentId),
        title: `${n.client} at ${n.time}`,
        detail: `Missed ${n.noShowPercent}% of ${n.visits} visits. A reminder call could help.`,
      })),
      total: brief.likelyNoShows.length,
      empty: "Everyone on the book usually shows.",
    },
    {
      id: "due",
      title: "Due back, nothing booked",
      rows: brief.dueNotBooked.top.map((d) => ({
        key: briefItemKey.due(d),
        href: `/clients/${d.clientId}`,
        title: d.client,
        detail: [d.usualWeeks && `Every ~${d.usualWeeks} wk`, d.overdueDays ? `${d.overdueDays} days overdue` : "Due now"].filter(Boolean).join(" · "),
      })),
      total: brief.dueNotBooked.total,
      seeAll: "/clients?due=1",
      empty: "No regulars overdue.",
    },
    {
      id: "stock",
      title: "Low stock for today",
      rows: brief.lowStock.map((p) => ({ key: briefItemKey.stock(p), href: `/inventory/${p.productId}`, title: p.name, detail: "Below its reorder point, and today's visits need it." })),
      total: brief.lowStock.length,
      empty: "Enough of everything today's services use.",
    },
    {
      id: "credit",
      title: "Coming in with credit",
      rows: brief.credits.map((c) => ({ key: briefItemKey.credit(c), href: `/clients/${c.clientId}`, title: c.client, detail: creditText(c) })),
      total: brief.credits.length,
      empty: "No one today has package uses or gift card money.",
    },
    {
      id: "events",
      title: "Events coming up",
      rows: brief.events.map((e) => ({ key: briefItemKey.event(e), href: `/events/${e.eventId}`, title: e.title, detail: e.detail, label: `${e.title}: ${e.detail}` })),
      total: brief.events.length,
      seeAll: "/events",
      empty: "Every event coming up is in order.",
    },
  ];

  const shown = sections.map((s) => {
    const rows = s.rows.filter((r) => !dismissed.has(r.key));
    return { ...s, rows, total: s.total - (s.rows.length - rows.length) };
  });
  const busy = shown.filter((s) => s.rows.length > 0 || s.total > 0);
  const clear = shown.filter((s) => !(s.rows.length > 0 || s.total > 0));

  // Only the sections with something in them, filling the row (no empty
  // slots); the rest in one quiet "All clear" row.
  return (
    <div className="flex flex-col gap-6" data-testid="dashboard-brief">
      {busy.length > 0 && (
        <div className="flex flex-wrap gap-x-8 gap-y-6">
          {busy.map((s) => (
            <BriefSection
              key={s.id}
              id={s.id}
              title={s.title}
              rows={s.rows}
              total={s.total}
              seeAll={s.seeAll}
              onDismiss={(key) => {
                setDismissed((all) => new Set([...all, key]));
                void dismissDeniseItem(key, today);
              }}
            />
          ))}
        </div>
      )}
      <AllClear
        tone="denise"
        items={clear.map((s) => ({ title: s.title, why: s.empty, testId: `brief-${s.id}` }))}
        className={busy.length ? "" : "py-1"}
      />
    </div>
  );
}

function BriefSection({
  id,
  title,
  rows,
  total,
  seeAll,
  onDismiss,
}: {
  id: string;
  title: string;
  rows: Row[];
  total: number;
  // A page with the whole list, when there's more than the brief holds.
  seeAll?: string;
  onDismiss: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, TOP);
  const more = total - shown.length;
  const link = "self-start text-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline";
  return (
    <section aria-labelledby={`brief-${id}`} data-testid={`brief-${id}`} className="flex min-w-0 flex-1 basis-72 flex-col">
      <h3 id={`brief-${id}`} className="flex items-baseline justify-between gap-2 border-b border-denise-200 pb-2 text-13 font-semibold text-denise-900">
        {title}
        {total > 0 && <span className="text-xs font-normal text-ink-subtle tabular-nums">{total}</span>}
      </h3>
      {shown.length > 0 && (
        <ul className="divide-y divide-denise-100">
          {shown.map((r) => (
            <li key={r.key} className="group flex animate-fade-in items-start gap-2 py-2.5">
              <Link href={r.href} className="min-w-0 flex-1 text-sm">
                <span className="block font-medium text-ink underline-offset-2 group-hover:underline">{r.title}</span>
                <span className="block text-13 text-ink-muted">{r.detail}</span>
              </Link>
              <button
                type="button"
                aria-label={`Dismiss ${r.label ?? r.title}`}
                title="Dismiss"
                onClick={() => onDismiss(r.key)}
                className="-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-(--motion-fast) hover:bg-denise-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                <CloseIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {more > 0 &&
        (seeAll && rows.length <= shown.length ? (
          <Link href={seeAll} className={`${link} mt-1`}>
            See all {total}
          </Link>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={`${link} mt-1`}>
            See all {total}
          </button>
        ))}
      {open && rows.length > TOP && (
        <button type="button" onClick={() => setOpen(false)} className={`${link} mt-1`}>
          Show fewer
        </button>
      )}
    </section>
  );
}
