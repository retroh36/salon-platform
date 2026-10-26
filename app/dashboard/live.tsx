"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, EmptyState, Section, textLinkClass, type Tone } from "@/components/ui/page";
import type { LiveData, LiveVisit, StylistCard } from "@/lib/dashboard-load";
import type { StylistStatus } from "@/lib/dashboard";
import { formatMinute } from "@/lib/scheduling/time";
import { refreshLive } from "./actions";

const REFRESH_MS = 30_000;

// Keeps "Right now" and "Team today" current: every 30 seconds while the
// tab is in view, and when it comes back into view.
function useLive(initial: LiveData): LiveData {
  const [live, setLive] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await refreshLive().catch(() => null);
      if (next && !stopped) setLive(next);
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return live;
}

const STATUS: Record<StylistStatus, { label: string; tone: Tone }> = {
  in_service: { label: "In service", tone: "info" },
  free: { label: "Free", tone: "success" },
  on_break: { label: "On break", tone: "neutral" },
  running_late: { label: "Running late", tone: "warning" },
  done: { label: "Done for today", tone: "neutral" },
  off: { label: "Out", tone: "neutral" },
};

export function LiveSections({ initial, mineOnly }: { initial: LiveData; mineOnly: boolean }) {
  const live = useLive(initial);
  return (
    <>
      <RightNow live={live} mineOnly={mineOnly} />
      {!mineOnly && <TeamToday team={live.team} />}
    </>
  );
}

function RightNow({ live, mineOnly }: { live: LiveData; mineOnly: boolean }) {
  const quiet = !live.inChair.length && !live.upNext.length && !live.late.length;
  return (
    <section aria-labelledby="right-now-heading" className="mb-8 animate-fade-in overflow-hidden rounded-lg border border-line bg-surface" data-testid="right-now">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="right-now-heading" className="flex items-center gap-2 text-base font-semibold text-ink">
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success-dot/50 motion-reduce:hidden" />
            <span className="relative inline-flex size-2 rounded-full bg-success-dot" />
          </span>
          Right now
        </h2>
        <span className="text-13 text-ink-muted tabular-nums">{formatMinute(live.nowMinute)}</span>
      </div>
      {quiet ? (
        <EmptyState art={false} className="py-8">{mineOnly ? "No one in your chair, and nothing in the next hour." : "No one in the chair, and nothing in the next hour."}</EmptyState>
      ) : (
        <div className="grid gap-px bg-line md:grid-cols-3">
          <Column title="In the chair" empty="No one yet." visits={live.inChair} line={(v) => `${v.service} · with ${v.staffName}`} testId="in-chair" />
          <Column title="Next hour" empty="Nothing starting." visits={live.upNext} line={(v) => `${formatMinute(v.start)} · ${v.service} · ${v.staffName}`} testId="up-next" />
          <Column
            title="Running late"
            empty="Everyone's on time."
            visits={live.late}
            line={(v) => `due ${formatMinute(v.start)} with ${v.staffName}`}
            tag={(v) => `${(v as LiveVisit & { lateMinutes: number }).lateMinutes} min late`}
            testId="running-late"
          />
        </div>
      )}
    </section>
  );
}

function Column({ title, empty, visits, line, tag, testId }: { title: string; empty: string; visits: LiveVisit[]; line: (v: LiveVisit) => string; tag?: (v: LiveVisit) => string; testId: string }) {
  return (
    <div className="bg-surface px-4 py-3" data-testid={testId}>
      <p className="mb-2 text-13 font-medium text-ink-muted">
        {title} {visits.length > 0 && <span className="font-normal text-ink-subtle tabular-nums">{visits.length}</span>}
      </p>
      {visits.length === 0 ? (
        <p className="text-sm text-ink-subtle">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visits.slice(0, 5).map((v) => (
            <li key={v.itemId} className="animate-fade-in">
              <Link href={`/calendar?open=${v.appointmentId}`} className="group -mx-2 block rounded-md px-2 py-1.5 transition-colors duration-(--motion-fast) hover:bg-sunken">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ink underline-offset-2 group-hover:underline">{v.client}</span>
                  {tag && <Badge tone="warning">{tag(v)}</Badge>}
                </span>
                <span className="block text-13 text-ink-muted">{line(v)}</span>
              </Link>
            </li>
          ))}
          {visits.length > 5 && <li className="text-13 text-ink-muted">and {visits.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}

function TeamToday({ team }: { team: StylistCard[] }) {
  return (
    <Section
      title="Team today"
      titleId="team-today-heading"
      count={team.length || undefined}
      className="animate-fade-in"
      actions={
        <Link href="/team" className={`text-sm ${textLinkClass}`}>
          Team
        </Link>
      }
    >
      {team.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState art={false} className="py-6">No one is working today.</EmptyState>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3" aria-label="Stylists working today">
          {team.map((s) => (
            <li key={s.staffId}>
              <Link
                href={`/calendar?staff=${s.staffId}`}
                data-testid="team-card"
                className="group flex h-full flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 transition-colors duration-(--motion-fast) hover:border-line-strong hover:bg-sunken/40 focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="flex items-center gap-2.5">
                  <Avatar name={s.name} color={s.color} level={s.level} photoUrl={s.photoUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink underline-offset-2 group-hover:underline">{s.name}</span>
                    <span className="block text-xs text-ink-muted tabular-nums">{s.percent === null ? "No hours" : `${s.percent}% booked`}</span>
                  </span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-navy-700 transition-[width] duration-(--motion-slow)" style={{ width: `${Math.min(100, s.percent ?? 0)}%` }} />
                </span>
                <span className="text-xs text-ink-muted">{s.next ? `Next: ${s.next.client}, ${formatMinute(s.next.start)}` : "No one else today"}</span>
                <Badge tone={STATUS[s.status].tone} className="self-start">
                  {STATUS[s.status].label}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
