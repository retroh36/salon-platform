"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { labelClass, selectClass } from "@/components/ui/field";
import { ChevronLeftIcon, ChevronRightIcon, WarningIcon } from "@/components/ui/icons";
import { Alert, Badge, EmptyState, Section } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { formatDay } from "@/lib/schedule-format";
import type { Floor, FloorStation } from "@/lib/floor-load";
import { addDays, formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { holdsSomeone, STATION_KINDS } from "@/lib/stations";
import { trackRange } from "@/lib/team-schedule";
import { endLoan, lendStation } from "./actions";

const range = (m: { start: number; end: number }) => `${formatMinute(m.start)}–${formatMinute(m.end)}`;

// The day's stations, grouped by kind: a track across the salon's hours
// with who's at each one, and clients booked into it.
export function FloorView({ floor, today, editable }: { floor: Floor; today: LocalDate; editable: boolean }) {
  const router = useRouter();
  const [lending, setLending] = useState<FloorStation | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const track = trackRange(floor.open, floor.stations.flatMap((s) => [...s.uses, ...s.visits]));
  const span = track.end - track.start;
  const at = (m: { start: number; end: number }) => ({
    left: `${((Math.max(m.start, track.start) - track.start) / span) * 100}%`,
    width: `${((Math.min(m.end, track.end) - Math.max(m.start, track.start)) / span) * 100}%`,
  });
  const run = (action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const r = await action();
      setNotice({ tone: r.ok ? "success" : "error", text: r.message });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  const label = floor.date === today ? "Today" : formatDay(floor.date, true);

  return (
    <div data-testid="floor">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/scheduling/floor?date=${addDays(floor.date, -1)}`} className={buttonClass("secondary", "sm", "", { square: true })} aria-label="Previous day">
          <ChevronLeftIcon className="size-4" />
        </Link>
        <Link href="/scheduling/floor" className={buttonClass("secondary", "sm")}>
          Today
        </Link>
        <Link href={`/scheduling/floor?date=${addDays(floor.date, 1)}`} className={buttonClass("secondary", "sm", "", { square: true })} aria-label="Next day">
          <ChevronRightIcon className="size-4" />
        </Link>
        <h2 className="ml-1 text-base font-semibold text-ink">{label}</h2>
        {floor.open.length === 0 && <Badge tone="neutral">Salon closed</Badge>}
      </div>
      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      {floor.stations.length === 0 && <EmptyState>No stations yet. Add them on Settings → Stations.</EmptyState>}
      {STATION_KINDS.map((k) => {
        const list = floor.stations.filter((s) => s.kind === k.value);
        if (!list.length) return null;
        return (
          <Section key={k.value} title={k.plural} titleId={`floor-${k.value}`} className="mb-8">
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" aria-labelledby={`floor-${k.value}`}>
              {list.map((s) => {
                const home = s.homeStaffId ? floor.working.find((w) => w.id === s.homeStaffId) : null;
                const lendable = editable && holdsSomeone(s.kind) && !home;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-station={s.name}>
                    <div className="w-36 shrink-0">
                      <p className="text-sm font-medium text-ink">{s.name}</p>
                      {s.area && <p className="text-xs text-ink-muted">{s.area}</p>}
                    </div>
                    <div className="relative h-8 min-w-48 flex-1 rounded-md bg-sunken/60" aria-hidden>
                      {s.uses.map((u, i) => (
                        <span
                          key={`u${i}`}
                          className={`absolute inset-y-1 flex items-center overflow-hidden rounded border px-1.5 text-xs font-medium whitespace-nowrap ${u.lent ? "border-active bg-active-soft text-active-ink" : "border-navy-200 bg-navy-100 text-navy-900"}`}
                          style={at(u)}
                          title={`${u.name}, ${range(u)}`}
                        >
                          {u.name}
                        </span>
                      ))}
                      {s.visits.map((v, i) => (
                        <span key={`v${i}`} className="absolute inset-y-1 flex items-center overflow-hidden rounded border border-line-strong bg-surface px-1.5 text-xs whitespace-nowrap text-ink" style={at(v)} title={`${v.client} with ${v.stylist}, ${range(v)}`}>
                          {v.client}
                        </span>
                      ))}
                    </div>
                    <div className="w-full text-13 text-ink-muted sm:w-64" data-testid="station-uses">
                      {s.uses.length === 0 && s.visits.length === 0 && !s.homeStaffId && <p>Free all day</p>}
                      {s.uses.map((u, i) => (
                        <p key={i} className="flex items-center justify-between gap-2">
                          <span>
                            <span className="text-ink">{u.lent ? `${u.name} is using it` : u.name}</span> · {range(u)}
                          </span>
                          {u.lent && u.assignmentId && editable && (
                            <Button variant="quiet" size="xs" disabled={pending} onClick={() => run(() => endLoan(u.assignmentId!))} aria-label={`Give ${s.name} back from ${u.name}`}>
                              Give back
                            </Button>
                          )}
                        </p>
                      ))}
                      {s.visits.map((v, i) => (
                        <p key={`v${i}`}>
                          <span className="text-ink">{v.client}</span> with {v.stylist} · {range(v)}
                        </p>
                      ))}
                      {s.clashes.length > 0 && (
                        <p className="mt-1 flex items-center gap-1 text-warning">
                          <WarningIcon className="size-3.5" />
                          {s.clashes[0][0].name} and {s.clashes[0][1].name} are both on it
                        </p>
                      )}
                      {s.homeStaffId && !home && s.uses.length === 0 && <p>Its stylist is off today.</p>}
                      {lendable && (
                        <Button variant="quiet" size="xs" className="-ml-2" onClick={() => setLending(s)}>
                          Lend {s.name}…
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        );
      })}
      {lending && (
        <LendSheet
          station={lending}
          floor={floor}
          pending={pending}
          onClose={() => setLending(null)}
          onLend={(staffId) => run(() => lendStation({ resourceId: lending.id, staffId, date: floor.date }), () => setLending(null))}
        />
      )}
    </div>
  );
}

function LendSheet({ station, floor, pending, onClose, onLend }: { station: FloorStation; floor: Floor; pending: boolean; onClose: () => void; onLend: (staffId: string) => void }) {
  const candidates = floor.working.filter((w) => !station.uses.some((u) => u.staffId === w.id));
  const [staffId, setStaffId] = useState(candidates.find((c) => !c.hasChair)?.id ?? candidates[0]?.id ?? "");
  const who = candidates.find((c) => c.id === staffId);
  return (
    <Sheet title={`Lend ${station.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody else is working that day.</p>
        ) : (
          <label className={labelClass}>
            Who&rsquo;s using it
            <select className={selectClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.hasChair ? "" : " (no chair today)"}
                </option>
              ))}
            </select>
          </label>
        )}
        {who && (
          <p className="text-13 text-ink-muted">
            For {who.firstName}&rsquo;s shift: {who.hours.map(range).join(", ")}. Their clients are booked into it.
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !who} onClick={() => onLend(staffId)}>
            Lend it
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
