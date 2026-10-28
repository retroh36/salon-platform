"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Badge, EmptyState, Section } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { actionsClass, tableClass, TableCard, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { holdsSomeone, type StationKind } from "@/lib/stations";
import { saveStation } from "./actions";

type Station = { id: string; name: string; kind: StationKind; area: string | null; isActive: boolean; homeStaffId: string | null };
type Person = { id: string; name: string; role: string };

// The stations, grouped by kind, each opening its form; "Add station" opens
// an empty one.
export function StationsEditor({ kinds, stations, people }: { kinds: { value: StationKind; label: string; plural: string }[]; stations: Station[]; people: Person[] }) {
  const [editing, setEditing] = useState<Station | "new" | null>(null);
  const name = new Map(people.map((p) => [p.id, p.name]));
  return (
    <>
      <div className="mb-6 flex justify-end">
        <Button onClick={() => setEditing("new")}>Add station</Button>
      </div>
      {stations.length === 0 && <EmptyState>No stations yet. Add the salon&rsquo;s chairs first.</EmptyState>}
      {kinds.map((k) => {
        const list = stations.filter((s) => s.kind === k.value);
        if (!list.length) return null;
        return (
          <Section key={k.value} title={k.plural} titleId={`stations-${k.value}`} className="mb-8">
            <TableCard>
              <table className={tableClass} aria-labelledby={`stations-${k.value}`}>
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Where</th>
                    {holdsSomeone(k.value) && <th className={thClass}>Home of</th>}
                    <th className={thClass}>
                      <span className="sr-only">Status</span>
                    </th>
                    <th className={actionsClass}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className={trClass}>
                      <td className={`${tdClass} font-medium text-ink`}>{s.name}</td>
                      <td className={`${tdClass} text-ink-muted`}>{s.area ?? "—"}</td>
                      {holdsSomeone(k.value) && <td className={tdClass}>{s.homeStaffId ? name.get(s.homeStaffId) : <span className="text-ink-muted">Nobody</span>}</td>}
                      <td className={tdClass}>{!s.isActive && <Badge tone="neutral">Out of use</Badge>}</td>
                      <td className={actionsClass}>
                        <Button variant="quiet" size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          </Section>
        );
      })}
      {editing && <StationForm key={editing === "new" ? "new" : editing.id} station={editing === "new" ? null : editing} kinds={kinds} people={people} stations={stations} onClose={() => setEditing(null)} />}
    </>
  );
}

function StationForm({ station, kinds, people, stations, onClose }: { station: Station | null; kinds: { value: StationKind; label: string }[]; people: Person[]; stations: Station[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof saveStation>[1], form: FormData) => {
    const r = await saveStation(station?.id ?? "", prev, form);
    if (r?.ok) onClose();
    return r;
  }, undefined);
  const [kind, setKind] = useState<StationKind>(station?.kind ?? "chair");
  const homeOf = new Map(stations.filter((s) => s.homeStaffId && s.id !== station?.id).map((s) => [s.homeStaffId!, s.name]));
  const stylists = people.filter((p) => p.role === "stylist" || p.role === "assistant" || p.role === "owner" || p.role === "manager");
  return (
    <Sheet title={station ? `Edit ${station.name}` : "Add station"} onClose={onClose}>
      <form action={action} className="flex flex-col gap-4" aria-label={station ? `Edit ${station.name}` : "Add station"}>
        <label className={labelClass}>
          Name
          <input name="name" defaultValue={station?.name ?? ""} className={fieldClass} aria-invalid={Boolean(state?.errors?.name)} required maxLength={40} placeholder="Chair 8" />
          {state?.errors?.name && <span className="text-13 font-normal text-danger">{state.errors.name}</span>}
        </label>
        <label className={labelClass}>
          Type
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as StationKind)} className={selectClass}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Where it is (optional)
          <input name="area" defaultValue={station?.area ?? ""} className={fieldClass} aria-invalid={Boolean(state?.errors?.area)} maxLength={60} placeholder="Upstairs" />
          {state?.errors?.area && <span className="text-13 font-normal text-danger">{state.errors.area}</span>}
        </label>
        {holdsSomeone(kind) && (
          <label className={labelClass}>
            Home of
            <select name="home_staff_id" defaultValue={station?.homeStaffId ?? ""} className={selectClass}>
              <option value="">Nobody</option>
              {stylists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {homeOf.has(p.id) ? ` (now ${homeOf.get(p.id)})` : ""}
                </option>
              ))}
            </select>
            <span className="text-13 font-normal text-ink-muted">Their clients are booked into it. On days they&rsquo;re off, it can be lent to someone else in Scheduling.</span>
          </label>
        )}
        <label className="flex items-center gap-3 text-sm text-ink">
          <input type="checkbox" name="is_active" defaultChecked={station?.isActive ?? true} className={checkboxClass} />
          In use
        </label>
        {state?.message && !state.ok && (
          <p className="text-sm text-danger" role="alert">
            {state.message}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {station ? "Save" : "Add station"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
