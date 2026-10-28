"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, textLinkClass } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { WEEKDAY_NAMES } from "@/lib/schedule-forms";
import type { WeeklyHours } from "@/lib/scheduling/availability";
import { WEEKDAYS } from "@/lib/scheduling/time";
import { shiftProblem } from "@/lib/team-schedule";
import type { GridPerson } from "@/lib/team-schedule-load";
import { savePattern, type PatternResult } from "./actions";
import { ShiftsField } from "./shifts-field";

const WEEK_NAMES = ["Week 1", "Week 2", "Week 3", "Week 4"];

// Someone's repeating pattern: the same every week, or over 2 to 4 weeks
// ("every other Saturday off"), counted from a week. Every week without
// published changes of its own follows it.
export function PatternEditor({ person, week, onClose }: { person: GridPerson; week: string; onClose: () => void }) {
  const router = useRouter();
  const [weeks, setWeeks] = useState<WeeklyHours[]>(person.pattern.weeks.length ? person.pattern.weeks : [{}]);
  const [startsOn, setStartsOn] = useState(person.pattern.startsOn ?? week);
  const [result, setResult] = useState<PatternResult | null>(null);
  const [pending, start] = useTransition();

  const setCount = (n: number) => setWeeks((w) => Array.from({ length: n }, (_, i) => w[i] ?? { ...w[0] }));
  const problem = weeks.flatMap((w) => WEEKDAYS.map((d) => shiftProblem(w[d] ?? []))).find(Boolean) ?? null;
  const submit = (anyway: boolean) =>
    start(async () => {
      const r = await savePattern({ staffId: person.id, startsOn, weeks }, anyway);
      setResult(r);
      if (r.ok) {
        router.refresh();
        onClose();
      }
    });

  return (
    <Sheet title={`${person.firstName}'s repeating pattern`} onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-4">
          <label className={labelClass}>
            Repeats
            <select className={`${selectClass} w-44`} value={weeks.length} onChange={(e) => setCount(Number(e.target.value))}>
              <option value={1}>Every week</option>
              <option value={2}>Every 2 weeks</option>
              <option value={3}>Every 3 weeks</option>
              <option value={4}>Every 4 weeks</option>
            </select>
          </label>
          {weeks.length > 1 && (
            <label className={labelClass}>
              Week 1 is the week of
              <input type="date" className={`${fieldClass} w-44`} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </label>
          )}
        </div>
        {weeks.map((w, n) => (
          <section key={n} aria-label={weeks.length > 1 ? WEEK_NAMES[n] : "Every week"}>
            {weeks.length > 1 && <h3 className="mb-2 text-sm font-semibold text-ink">{WEEK_NAMES[n]}</h3>}
            <div className="divide-y divide-line rounded-lg border border-line">
              {WEEKDAYS.map((d) => (
                <div key={d} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                  <span className="w-24 pt-2 text-sm font-medium text-ink">{WEEKDAY_NAMES[d]}</span>
                  <ShiftsField
                    label={`${weeks.length > 1 ? `${WEEK_NAMES[n]} ` : ""}${WEEKDAY_NAMES[d]}`}
                    shifts={w[d] ?? []}
                    open={[]}
                    onChange={(shifts) => setWeeks((all) => all.map((x, i) => (i === n ? { ...x, [d]: shifts } : x)))}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        {problem && (
          <p className="text-sm text-danger" role="alert">
            {problem}
          </p>
        )}
        {result && !result.ok && (
          <Alert tone={result.affected ? "warning" : "error"}>
            {result.message}
            {result.affected && (
              <ul className="mt-2 flex flex-col gap-1">
                {result.affected.map((a) => (
                  <li key={a.href}>
                    {a.label} ·{" "}
                    <Link href={a.href} className={textLinkClass}>
                      Move them
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <p className="text-13 text-ink-muted">Saving changes the weeks ahead straight away (days with published changes of their own stay as they are), and tells {person.firstName}.</p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {result && !result.ok && result.affected ? (
            <Button disabled={pending} onClick={() => submit(true)}>
              Save anyway
            </Button>
          ) : (
            <Button disabled={pending || Boolean(problem)} onClick={() => submit(false)}>
              Save pattern
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
