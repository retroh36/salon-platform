"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass } from "@/components/ui/field";
import { CloseIcon } from "@/components/ui/icons";
import { Alert } from "@/components/ui/page";
import { ReorderList } from "@/components/ui/reorder-list";
import { Sheet } from "@/components/ui/sheet";
import { offLabel, viewProblems, VIEW_NAME_MAX, type CalendarView } from "@/lib/calendar-views";
import type { ColumnData } from "./types";
import { deleteCalendarView, saveCalendarView } from "./view-actions";
import { useKeepOnScreen } from "@/components/ui/keep-on-screen";

// The "10 off today" chip in the calendar's toolbar: who's off and why,
// and a switch to show them anyway.
export function OffChip({ off, shown, onShow, isToday }: { off: ColumnData[]; shown: boolean; onShow: (show: boolean) => void; isToday: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useKeepOnScreen(pop, open);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const label = offLabel(off.length, isToday);

  return (
    <div ref={root} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="off-chip"
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-focus ${
          shown ? "border-navy-700 bg-navy-100 text-navy-900" : "border-line-strong bg-surface text-ink-muted hover:bg-sunken"
        }`}
      >
        {label}
        {shown && <span className="font-normal">· shown</span>}
      </button>
      {open && (
        <div
          ref={pop}
          role="dialog"
          aria-label={isToday ? "Off today" : "Off this day"}
          className="absolute top-full left-0 z-50 mt-2 flex w-[min(22rem,calc(100vw-2rem))] origin-top-left animate-pop-in flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-lift"
        >
          <h2 className="text-sm font-semibold text-ink">{isToday ? "Off today" : "Off this day"}</h2>
          <ul aria-label="Who's off" className="-mx-1 flex max-h-72 flex-col overflow-y-auto">
            {off.map((c) => (
              <li key={c.staffId} className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <Avatar name={c.name} color={c.color} level={c.level} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                <span className="shrink-0 text-sm text-ink-muted">{c.offReason}</span>
              </li>
            ))}
          </ul>
          <label className="flex cursor-pointer items-center gap-2.5 border-t border-line pt-3 text-sm text-ink">
            <input type="checkbox" checked={shown} onChange={(e) => onShow(e.target.checked)} className={checkboxClass} />
            Show them on the calendar anyway
          </label>
        </div>
      )}
    </div>
  );
}

export type Department = { label: string; staffIds: string[] };

// Making or changing a saved view: its name, whether everyone sees it
// (owners), who's in it and in what order.
export function ViewEditor({
  view,
  start,
  team,
  departments,
  views,
  canShare,
  onClose,
  onSaved,
  onDeleted,
}: {
  view: CalendarView | null;
  // A new view starts with whoever is on the calendar now.
  start: string[];
  team: ColumnData[];
  departments: Department[];
  views: CalendarView[];
  canShare: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(view?.name ?? "");
  const [shared, setShared] = useState(view?.shared ?? false);
  const [picked, setPicked] = useState<string[]>(view ? view.staffIds.filter((id) => team.some((c) => c.staffId === id)) : start);
  const [find, setFind] = useState("");
  const [problems, setProblems] = useState<{ name?: string; staff?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, run] = useTransition();
  const byId = new Map(team.map((c) => [c.staffId, c]));
  const found = team.filter((c) => c.name.toLowerCase().includes(find.trim().toLowerCase()));
  const pick = (ids: string[], on: boolean) => setPicked((p) => (on ? [...p, ...ids.filter((id) => !p.includes(id))] : p.filter((id) => !ids.includes(id))));

  function save() {
    const others = views.filter((v) => v.id !== view?.id && v.shared === shared && (shared || v.editable)).map((v) => v.name);
    const found = viewProblems(name, picked, others);
    setProblems(found);
    if (found.name || found.staff) return;
    run(async () => {
      const result = await saveCalendarView({ id: view?.id ?? null, name, staffIds: picked, shared });
      if (result.ok) onSaved(result.id);
      else if (result.field) setProblems({ [result.field]: result.message });
      else setMessage(result.message);
    });
  }

  function remove() {
    run(async () => {
      const result = await deleteCalendarView(view!.id);
      if (result.ok) onDeleted();
      else setMessage(result.message ?? "That view couldn't be deleted.");
    });
  }

  return (
    <Sheet title={view ? `Edit ${view.name}` : "New view"} onClose={onClose} wide>
      <form
        aria-label={view ? "Edit view" : "New view"}
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {message && <Alert>{message}</Alert>}
        <label className={labelClass}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={VIEW_NAME_MAX} placeholder="Hair team, Color, My section…" className={fieldClass} aria-invalid={!!problems.name} />
          {problems.name && <span className="text-xs font-normal text-danger">{problems.name}</span>}
        </label>
        {canShare && (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className={`${checkboxClass} mt-0.5`} />
            <span>
              Share with everyone at the salon
              <span className="block text-ink-muted">Otherwise only you see it.</span>
            </span>
          </label>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">Who&apos;s in it</legend>
            {departments.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Add a department" role="group">
                {departments.map((d) => (
                  <Button key={d.label} size="sm" variant="secondary" onClick={() => pick(d.staffIds, true)}>
                    + {d.label}
                  </Button>
                ))}
              </div>
            )}
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a stylist" aria-label="Find a stylist" className={fieldClass} />
            <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line p-1" aria-label="Stylists">
              {found.map((c) => (
                <li key={c.staffId}>
                  <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm text-ink hover:bg-sunken">
                    <input type="checkbox" checked={picked.includes(c.staffId)} onChange={(e) => pick([c.staffId], e.target.checked)} className={checkboxClass} />
                    <Avatar name={c.name} color={c.color} level={c.level} size="sm" />
                    <span className="truncate">{c.name}</span>
                  </label>
                </li>
              ))}
              {found.length === 0 && <li className="px-2 py-3 text-sm text-ink-muted">No one by that name.</li>}
            </ul>
            {problems.staff && <p className="text-xs text-danger">{problems.staff}</p>}
          </fieldset>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium text-ink">
              In this order <span className="font-normal text-ink-subtle tabular-nums">({picked.length})</span>
            </h3>
            <p className="text-sm text-ink-muted">Left to right on the calendar. Drag or use the arrows.</p>
            {picked.length ? (
              <ReorderList
                label="Order in this view"
                onChange={setPicked}
                items={picked.flatMap((id) => {
                  const c = byId.get(id);
                  return c
                    ? [
                        {
                          id,
                          label: c.name,
                          trailing: (
                            <IconButton label={`Take ${c.name} out`} size="sm" onClick={() => pick([id], false)}>
                              <CloseIcon className="size-4" />
                            </IconButton>
                          ),
                        },
                      ]
                    : [];
                })}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-ink-muted">Tick the stylists to show.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save view"}
          </Button>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {view &&
            (confirmDelete ? (
              <span className="ml-auto flex items-center gap-2" role="group" aria-label="Delete view">
                <span className="text-sm text-ink">Delete {view.name}{view.shared ? " for everyone" : ""}?</span>
                <Button variant="danger" size="sm" disabled={pending} onClick={remove}>
                  Delete
                </Button>
                <Button size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </span>
            ) : (
              <Button variant="danger-quiet" className="ml-auto" onClick={() => setConfirmDelete(true)}>
                Delete view
              </Button>
            ))}
        </div>
      </form>
    </Sheet>
  );
}
