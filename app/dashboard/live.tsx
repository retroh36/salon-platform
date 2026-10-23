"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
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

const STATUS: Record<StylistStatus, { label: string; className: string }> = {
  in_service: { label: "In service", className: "bg-status-checked-in-bg text-status-checked-in-ink" },
  free: { label: "Free", className: "bg-status-confirmed-bg text-status-confirmed-ink" },
  on_break: { label: "On break", className: "bg-status-booked-bg text-status-booked-ink" },
  running_late: { label: "Running late", className: "bg-status-late-bg text-status-late-ink" },
  done: { label: "Done for today", className: "bg-status-completed-bg text-status-completed-ink" },
  off: { label: "Out", className: "bg-status-no-show-bg text-status-no-show-ink" },
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
    <section aria-labelledby="right-now-heading" className="mb-6 animate-fade-in rounded-xl border border-line bg-surface shadow-card" data-testid="right-now">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id="right-now-heading" className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-confirmed-ink/50 motion-reduce:hidden" />
            <span className="relative inline-flex size-2.5 rounded-full bg-status-confirmed-ink" />
          </span>
          Right now
        </h2>
        <span className="text-sm text-ink-muted tabular-nums">{formatMinute(live.nowMinute)}</span>
      </div>
      {quiet ? (
        <p className="px-5 py-6 text-sm text-ink-muted">{mineOnly ? "No one in your chair, and nothing in the next hour." : "No one in the chair, and nothing in the next hour."}</p>
      ) : (
        <div className="grid gap-px bg-line md:grid-cols-3">
          <Column title="In the chair" empty="No one yet." visits={live.inChair} line={(v) => `${v.service} · with ${v.staffName}`} testId="in-chair" />
          <Column title="Next hour" empty="Nothing starting." visits={live.upNext} line={(v) => `${formatMinute(v.start)} · ${v.service} · ${v.staffName}`} testId="up-next" />
          <Column
            title="Running late"
            empty="Everyone's on time."
            visits={live.late}
            line={(v) => `${(v as LiveVisit & { lateMinutes: number }).lateMinutes} min late · due ${formatMinute(v.start)} with ${v.staffName}`}
            tone="late"
            testId="running-late"
          />
        </div>
      )}
    </section>
  );
}

function Column({ title, empty, visits, line, tone, testId }: { title: string; empty: string; visits: LiveVisit[]; line: (v: LiveVisit) => string; tone?: "late"; testId: string }) {
  return (
    <div className="bg-surface px-5 py-4" data-testid={testId}>
      <p className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {title} {visits.length > 0 && <span className="tabular-nums">({visits.length})</span>}
      </p>
      {visits.length === 0 ? (
        <p className="text-sm text-ink-subtle">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visits.slice(0, 5).map((v) => (
            <li key={v.itemId} className="animate-fade-in">
              <Link href={`/calendar?open=${v.appointmentId}`} className="group block rounded-md px-2 py-1 -mx-2 transition-colors duration-(--motion-fast) hover:bg-sunken">
                <span className={`block text-sm font-semibold ${tone === "late" ? "text-status-late-ink" : "text-ink"}`}>{v.client}</span>
                <span className="block text-xs text-ink-muted">{line(v)}</span>
              </Link>
            </li>
          ))}
          {visits.length > 5 && <li className="text-xs text-ink-muted">and {visits.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}

function TeamToday({ team }: { team: StylistCard[] }) {
  return (
    <section aria-labelledby="team-today-heading" className="mb-6 animate-fade-in">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="team-today-heading" className="font-serif text-lg font-semibold text-ink">
          Team today
        </h2>
        <Link href="/team" className="text-sm font-medium text-link hover:text-link-hover hover:underline">
          Team
        </Link>
      </div>
      {team.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-5 py-6 text-sm text-ink-muted">No one is working today.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3" aria-label="Stylists working today">
          {team.map((s) => (
            <li key={s.staffId}>
              <Link
                href={`/calendar?staff=${s.staffId}`}
                data-testid="team-card"
                className="flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-3.5 shadow-card transition-[box-shadow,transform,border-color] duration-(--motion-fast) hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="flex items-center gap-2.5">
                  <Avatar name={s.name} color={s.color} level={s.level} photoUrl={s.photoUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{s.name}</span>
                    <span className="block text-xs text-ink-muted tabular-nums">{s.percent === null ? "No hours" : `${s.percent}% booked`}</span>
                  </span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <span className="block h-full rounded-full bg-navy-700 transition-[width] duration-(--motion-slow)" style={{ width: `${Math.min(100, s.percent ?? 0)}%` }} />
                </span>
                <span className="text-xs text-ink-muted">{s.next ? `Next: ${s.next.client}, ${formatMinute(s.next.start)}` : "No one else today"}</span>
                <span className={`self-start rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s.status].className}`}>{STATUS[s.status].label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
