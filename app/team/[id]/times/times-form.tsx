"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, selectClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import { numClass, TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { useUnsavedChanges } from "@/components/unsaved";
import { formatDuration } from "@/lib/duration";
import { copyTimings, ownOrMenu, timingChanges, timingProblem, totalOf, type Timing, type TimingRow } from "@/lib/stylist-timings";
import { saveStaffTimings } from "../../actions";

type Draft = { active: string; processing: string; finishing: string };
type Source = { id: string; name: string; times: Record<string, Timing | null> };

const draftOf = (t: Timing): Draft => ({ active: String(t.active), processing: String(t.processing), finishing: String(t.finishing) });
const PARTS = [
  ["active", "Active"],
  ["processing", "Processing"],
  ["finishing", "Finishing"],
] as const;

function parse(d: Draft): Timing | null {
  const n = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const t = { active: n(d.active), processing: n(d.processing), finishing: n(d.finishing) };
  return Object.values(t).some(Number.isNaN) ? null : t;
}

const menuText = (t: Timing) =>
  [formatDuration(t.active), t.processing ? `${formatDuration(t.processing)} processing` : "", t.finishing ? `${formatDuration(t.finishing)} finishing` : ""].filter(Boolean).join(" + ");

// Each service they do: the menu's time, and theirs in minutes (active,
// processing, finishing), with Copy from another stylist above.
export function TimesForm({ staffId, firstName, rows, sources }: { staffId: string; firstName: string; rows: TimingRow[]; sources: Source[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(rows);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((r) => [r.serviceId, draftOf(r.own ?? r.menu)])));
  const [from, setFrom] = useState(sources[0]?.id ?? "");
  const [note, setNote] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const current = useMemo(
    () =>
      saved.map((r) => {
        const t = parse(drafts[r.serviceId]);
        const problem = t ? timingProblem(t) : "Enter whole minutes.";
        return { row: { ...r, own: t && !problem ? ownOrMenu(r, t) : r.own }, problem };
      }),
    [saved, drafts],
  );
  const changes = timingChanges(
    saved,
    current.map((c) => c.row),
  );
  const invalid = current.filter((c) => c.problem).length;
  useUnsavedChanges(changes.length > 0 || invalid > 0);

  const set = (serviceId: string, part: keyof Draft, value: string) => setDrafts((d) => ({ ...d, [serviceId]: { ...d[serviceId], [part]: value } }));

  function copy() {
    const source = sources.find((s) => s.id === from);
    if (!source) return;
    const { rows: copied, copied: count, kept } = copyTimings(
      current.map((c) => c.row),
      source.times,
    );
    setDrafts((d) => ({ ...d, ...Object.fromEntries(copied.filter((r) => r.serviceId in source.times).map((r) => [r.serviceId, draftOf(r.own ?? r.menu)])) }));
    setNote(
      count === 0
        ? { tone: "info", text: `${source.name} doesn't do any of ${firstName}'s services.` }
        : {
            tone: "info",
            text: `Copied ${count === 1 ? "1 time" : `${count} times`} from ${source.name}${kept ? ` (${kept === 1 ? "1 service" : `${kept} services`} they don't do stayed as ${kept === 1 ? "it was" : "they were"})` : ""}. Check them, then Save.`,
          },
    );
  }

  function save() {
    start(async () => {
      const r = await saveStaffTimings(staffId, changes);
      setNote({ tone: r.ok ? "success" : "error", text: r.message });
      if (r.ok) {
        setSaved(current.map((c) => c.row));
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {sources.length > 0 && (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Copy times">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Copy from
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${selectClass} w-56`}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={copy}>Copy their times</Button>
        </div>
      )}
      {note && <Alert tone={note.tone}>{note.text}</Alert>}
      {saved.length === 0 ? (
        <p className="text-sm text-ink-muted">{firstName} doesn&apos;t do any services yet. Choose them on their page first.</p>
      ) : (
        <TableCard>
          <table className={tableClass} data-testid="service-times">
            <thead className={theadClass}>
              <tr>
                <th className={thClass}>Service</th>
                <th className={thClass}>Menu</th>
                {PARTS.map(([, label]) => (
                  <th key={label} className={`${thClass} ${numClass}`}>
                    {label} (min)
                  </th>
                ))}
                <th className={`${thClass} ${numClass}`}>Total</th>
                <th className={thClass}>
                  <span className="sr-only">Menu time</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {current.map(({ row, problem }) => {
                const d = drafts[row.serviceId];
                const t = parse(d);
                return (
                  <tr key={row.serviceId} className={trClass} data-service={row.name}>
                    <td className={tdClass}>
                      <span className="block font-medium text-ink">{row.name}</span>
                      <span className="block text-xs text-ink-muted">{row.category}</span>
                      {problem && (
                        <span className="block text-xs text-danger" role="alert">
                          {problem}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} text-ink-muted`}>{menuText(row.menu)}</td>
                    {PARTS.map(([part, label]) => (
                      <td key={part} className={`${tdClass} ${numClass}`}>
                        <input
                          aria-label={`${row.name} ${label.toLowerCase()} minutes`}
                          inputMode="numeric"
                          value={d[part]}
                          onChange={(e) => set(row.serviceId, part, e.target.value)}
                          aria-invalid={Boolean(problem)}
                          className={`${fieldClass} w-20 text-right tabular-nums`}
                        />
                      </td>
                    ))}
                    <td className={`${tdClass} ${numClass}`}>{t && !problem ? formatDuration(totalOf(t)) : "—"}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {row.own ? (
                        <span className="flex items-center gap-3">
                          <Badge tone="info">Their own</Badge>
                          <Button variant="quiet" size="sm" onClick={() => setDrafts((all) => ({ ...all, [row.serviceId]: draftOf(row.menu) }))}>
                            Use menu time
                          </Button>
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">Menu time</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={pending || changes.length === 0 || invalid > 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <span className="text-sm text-ink-muted">
          {invalid > 0 ? `Fix ${invalid === 1 ? "1 time" : `${invalid} times`} first.` : changes.length > 0 ? `${changes.length === 1 ? "1 change" : `${changes.length} changes`} not saved yet.` : "Everything is saved."}
        </span>
      </div>
    </div>
  );
}
