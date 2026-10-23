"use client";

import Link from "next/link";
import { useState } from "react";
import { dismissDeniseItem } from "@/app/calendar/denise-actions";
import { CloseIcon } from "@/components/ui/icons";
import { briefItemKey, creditText, type BriefFacts } from "@/lib/denise/brief";

// Shown per section before "See all".
const TOP = 3;

type Row = { key: string; href: string; title: string; detail: string };

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
  ];

  return (
    <div className="grid gap-3 border-t border-denise-200 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3" data-testid="dashboard-brief">
      {sections.map((s) => (
        <BriefSection
          key={s.id}
          id={s.id}
          title={s.title}
          rows={s.rows.filter((r) => !dismissed.has(r.key))}
          total={s.total - s.rows.filter((r) => dismissed.has(r.key)).length}
          seeAll={s.seeAll}
          empty={s.empty}
          onDismiss={(key) => {
            setDismissed((all) => new Set([...all, key]));
            void dismissDeniseItem(key, today);
          }}
        />
      ))}
    </div>
  );
}

function BriefSection({
  id,
  title,
  rows,
  total,
  seeAll,
  empty,
  onDismiss,
}: {
  id: string;
  title: string;
  rows: Row[];
  total: number;
  // A page with the whole list, when there's more than the brief holds.
  seeAll?: string;
  empty: string;
  onDismiss: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, TOP);
  const more = total - shown.length;
  return (
    <section aria-labelledby={`brief-${id}`} data-testid={`brief-${id}`} className="flex flex-col gap-2 rounded-xl border border-denise-200 bg-surface p-3">
      <h3 id={`brief-${id}`} className="flex items-baseline justify-between gap-2 text-sm font-semibold text-denise-900">
        {title}
        {total > 0 && <span className="text-xs font-medium text-ink-muted tabular-nums">{total}</span>}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((r) => (
            <li key={r.key} className="group flex animate-fade-in items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-denise-50">
              <Link href={r.href} className="min-w-0 flex-1 text-sm">
                <span className="block font-medium text-ink underline-offset-2 group-hover:underline">{r.title}</span>
                <span className="block text-ink-muted">{r.detail}</span>
              </Link>
              <button
                type="button"
                aria-label={`Dismiss ${r.title}`}
                title="Dismiss"
                onClick={() => onDismiss(r.key)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-(--motion-fast) hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                <CloseIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {more > 0 &&
        (seeAll && rows.length <= shown.length ? (
          <Link href={seeAll} className="self-start text-sm font-medium text-link underline-offset-2 hover:underline">
            See all {total}
          </Link>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="self-start text-sm font-medium text-link underline-offset-2 hover:underline">
            See all {total}
          </button>
        ))}
      {open && rows.length > TOP && (
        <button type="button" onClick={() => setOpen(false)} className="self-start text-sm font-medium text-link underline-offset-2 hover:underline">
          Show fewer
        </button>
      )}
    </section>
  );
}
