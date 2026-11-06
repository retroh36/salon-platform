"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { askDeniseAbout } from "@/components/denise-chat/store";
import { DeniseFace } from "@/components/denise";
import { Button, buttonClass } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { CloseIcon } from "@/components/ui/icons";
import { dateRefText, encodeReport, minVisitsOf, reportProblem, type ClientReport, type DateRef, type ReportSort } from "@/lib/client-reports";
import type { ReportMenu } from "@/lib/client-reports-load";

const DATE_CHOICES: [string, string][] = [
  ["today", "Today"],
  ["this_week", "Start of this week"],
  ["this_month", "Start of this month"],
  ["last_month", "Start of last month"],
  ["this_year", "Start of this year"],
  ["last_year", "Start of last year"],
  ["30 days ago", "30 days ago"],
  ["90 days ago", "90 days ago"],
  ["6 months ago", "6 months ago"],
  ["1 year ago", "1 year ago"],
  ["2 years ago", "2 years ago"],
];

const SORTS: [ReportSort, string][] = [
  ["last_visit", "Last visit, latest first"],
  ["visits", "Visits counted, most first"],
  ["next_visit", "Next visit, soonest first"],
  ["name", "Name"],
];

const isDay = (ref: string) => /^\d{4}-\d{2}(-\d{2})?$/.test(ref);

// A date as the words a report keeps ("Start of this year", "6 months
// ago"), or a day on the calendar.
function DateChoice({ label, value, onChange }: { label: string; value: DateRef | null; onChange: (v: DateRef | null) => void }) {
  const known = value === null || isDay(value) || DATE_CHOICES.some(([k]) => k === value);
  const choice = value === null ? "" : isDay(value) ? "date" : value;
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelClass}>
        {label}
        <select className={selectClass} value={choice} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "date" ? "" : e.target.value)}>
          <option value="">Any time</option>
          {DATE_CHOICES.map(([k, text]) => (
            <option key={k} value={k}>
              {text}
            </option>
          ))}
          {!known && value && <option value={value}>{dateRefText(value)}</option>}
          <option value="date">On a date…</option>
        </select>
      </label>
      {value !== null && (choice === "date" || value === "") && (
        <input
          type="date"
          aria-label={`${label}: date`}
          className={fieldClass}
          value={value.length === 7 ? `${value}-01` : value}
          onChange={(e) => onChange(e.target.value || "")}
        />
      )}
    </div>
  );
}

const count = (text: string) => (text.trim() === "" ? null : Math.max(0, Math.min(999, Math.floor(Number(text)))));

// The report's filters, set by hand (Denise sets the same from a question).
export function ReportForm({ initial, menu, today, stylists, spend }: { initial: ClientReport; menu: ReportMenu; today: string; stylists: boolean; spend: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<ClientReport>(initial);
  const set = (patch: Partial<ClientReport>) => setR((prev) => ({ ...prev, ...patch }));
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  // A day picked but not filled in yet doesn't count.
  const clean = (ref: DateRef | null) => (ref === "" ? null : ref);
  const ready: ClientReport = { ...r, from: clean(r.from), to: clean(r.to), noVisitSince: clean(r.noVisitSince), visitedSince: clean(r.visitedSince) };
  const problem = reportProblem(ready, today);
  const services = new Map(menu.services.map((s) => [s.id, s]));

  return (
    <form
      aria-label="Report filters"
      className="mb-8 flex flex-col gap-6 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) router.push(`/clients/reports?r=${encodeReport(ready)}`);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Set the filters, or describe the list to Denise in your own words.</p>
        <Button size="sm" onClick={() => askDeniseAbout("Make me a list of clients who ")}>
          <DeniseFace size={20} />
          Ask Denise for a report
        </Button>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Visits to count</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Categories">
          {menu.categories.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={checkboxClass} checked={r.categories.includes(c)} onChange={() => set({ categories: toggle(r.categories, c) })} />
              {c}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${labelClass} w-64`}>
            Or a service
            <select className={selectClass} value="" onChange={(e) => e.target.value && set({ serviceIds: [...new Set([...r.serviceIds, e.target.value])] })}>
              <option value="">Add a service…</option>
              {menu.categories.map((c) => (
                <optgroup key={c} label={c}>
                  {menu.services
                    .filter((s) => s.category === c && !r.serviceIds.includes(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          {r.serviceIds.map((id) => (
            <span key={id} className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-2 text-sm">
              {services.get(id)?.name ?? "A service"}
              <button type="button" aria-label={`Remove ${services.get(id)?.name ?? "service"}`} className={buttonClass("quiet", "xs", "", { square: true })} onClick={() => set({ serviceIds: r.serviceIds.filter((x) => x !== id) })}>
                <CloseIcon className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
        {stylists && (
          <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Stylists">
            {menu.stylists.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className={checkboxClass} checked={r.staffIds.includes(s.id)} onChange={() => set({ staffIds: toggle(r.staffIds, s.id) })} />
                {s.name}
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateChoice label="Counted from" value={r.from} onChange={(from) => set({ from })} />
          <DateChoice label="Until" value={r.to} onChange={(to) => set({ to })} />
          <label className={labelClass}>
            At least (visits)
            <input type="number" min={0} max={999} inputMode="numeric" className={fieldClass} placeholder={String(minVisitsOf(ready))} value={r.minVisits ?? ""} onChange={(e) => set({ minVisits: count(e.target.value) })} />
          </label>
          <label className={labelClass}>
            At most (visits)
            <input type="number" min={0} max={999} inputMode="numeric" className={fieldClass} placeholder="Any" value={r.maxVisits ?? ""} onChange={(e) => set({ maxVisits: count(e.target.value) })} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Last and next visit</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateChoice label="No visit since" value={r.noVisitSince} onChange={(noVisitSince) => set({ noVisitSince })} />
          <DateChoice label="A visit since" value={r.visitedSince} onChange={(visitedSince) => set({ visitedSince })} />
          <label className={labelClass}>
            Next visit
            <select className={selectClass} value={r.nextVisit ?? ""} onChange={(e) => set({ nextVisit: e.target.value === "booked" || e.target.value === "none" ? e.target.value : null })}>
              <option value="">Either</option>
              <option value="booked">Booked</option>
              <option value="none">Nothing booked</option>
            </select>
          </label>
          {spend && (
            <label className={labelClass}>
              Spent at least ($)
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className={fieldClass}
                placeholder="Any"
                value={r.minSpendCents === null ? "" : r.minSpendCents / 100}
                onChange={(e) => set({ minSpendCents: e.target.value === "" || Number(e.target.value) <= 0 ? null : Math.round(Number(e.target.value) * 100) })}
              />
            </label>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className={`${labelClass} w-64`}>
          Sort by
          <select className={selectClass} value={r.sort} onChange={(e) => set({ sort: e.target.value as ReportSort })}>
            {[...SORTS, ...(spend ? ([["spend", "Spend, most first"]] as [ReportSort, string][]) : [])].map(([k, text]) => (
              <option key={k} value={k}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {problem && (
            <p className="text-13 text-danger" role="alert">
              {problem}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={Boolean(problem)}>
            Run report
          </Button>
        </div>
      </div>
    </form>
  );
}
