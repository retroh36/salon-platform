"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useOptimistic, useRef, useState, ViewTransition } from "react";
import { DeniseFace } from "@/components/denise";
import { Avatar, initials } from "@/components/ui/avatar";
import { LEVEL_BG, LEVEL_BORDER } from "@/components/ui/level";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FitText } from "@/components/ui/fit-text";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, MoreIcon, PlusIcon, SendIcon } from "@/components/ui/icons";
import { Listbox } from "@/components/ui/listbox";
import { Segmented } from "@/components/ui/segmented";
import { Tabs } from "@/components/ui/tabs";
import { isEditable, STATUS_LABELS } from "@/lib/appointments";
import type { ChatMessage, DeniseState, FixMove, FixResult, FixView } from "@/lib/denise/types";
import { FAMILIES, FAMILY_LABELS, hourMarks, laneBox, layoutColumn, type ServiceFamily } from "@/lib/calendar";
import { LEVEL_LABELS, STAFF_LEVELS } from "@/lib/schedule-forms";
import { BLOCK_LABELS } from "@/lib/scheduling/blocks";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, formatMinute, toLocal } from "@/lib/scheduling/time";
import { moveGroupVisit, moveVisitItem, moveVisitItemScoped } from "./actions";
import type { Scope } from "@/lib/scheduling/series";
import { moveBlock } from "./block-actions";
import { BlockPanel, repeatLabel } from "./block-panel";
import { AppointmentPanel } from "./appointment-panel";
import { approveDeniseFix, askDenise, bookFromWaitlist, rejectDeniseFix, reportOut, scanDenise, undoDeniseFix } from "./denise-actions";
import { DenisePanel, type Outcome, type Preview } from "./denise-panel";
import { BookingPanel, type BookingStart } from "./booking-panel";
import { WalkInPanel } from "./walk-in-panel";
import { GroupPanel } from "./group-panel";
import { NowLine, useNow } from "./now-line";
import type { BlockData, BoardData, ColumnData, TimeBlockData } from "./types";

export const PX_PER_MINUTE = 2;
// Moves snap to 5 minutes; a click on an empty slot to the quarter hour.
const MOVE_STEP = 5;
const SLOT_STEP = 15;
// Pointer travel before a press counts as a drag rather than a click.
const DRAG_THRESHOLD = 5;

type Selection =
  | { kind: "none" }
  | { kind: "block"; blockId: string }
  | { kind: "new-block"; start: { staffId: string; startMinute: number } }
  | { kind: "book"; start: BookingStart }
  | { kind: "edit"; appointmentId: string }
  | { kind: "detail"; appointmentId: string }
  | { kind: "walk-ins" }
  | { kind: "group"; start: BookingStart };

type Tab = "denise" | "details";

type Move = { itemId: string; staffId: string; start: number };

// Dragging blocked time (moving it, or its bottom edge to resize it).
type BlockDrag = { key: string; block: TimeBlockData; mode: "move" | "resize"; pointerId: number; y: number; start: number; end: number; moved: boolean };

// A block in a column, or a preview of where Denise's fix would put one.
type Placed = BlockData & { ghost?: boolean; move?: FixMove };

type Drag = Move & {
  pointerId: number;
  x: number;
  y: number;
  fromStaffId: string;
  fromStart: number;
  length: number;
  moved: boolean;
};

// Day changes slide forward or back; other updates don't animate.
const DAY_SLIDE = { "nav-forward": "day-forward", "nav-back": "day-back", default: "none" };

export function CalendarBoard({ data }: { data: BoardData }) {
  const { range, me } = data;
  const router = useRouter();
  const height = (range.end - range.start) * PX_PER_MINUTE;
  const y = (minute: number) => (minute - range.start) * PX_PER_MINUTE;

  // What the right panel shows, and which off-duty stylists are expanded.
  // Both reset when the day changes.
  const [shownDate, setShownDate] = useState(data.date);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Denise: her view of the day (for the board's data she last looked at),
  // and what she's doing.
  const [denise, setDenise] = useState<{ state: DeniseState; for: BoardData } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Conflicts with nothing to approve, dismissed for now.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  if (shownDate !== data.date) {
    setShownDate(data.date);
    setSelection({ kind: "none" });
    setExpanded(new Set());
    setOutcome(null);
    setPreview(null);
  }
  const [tab, setTab] = useState<Tab>("denise");
  // The panel is closed until something opens it: a booking, a new
  // booking, Denise spotting something, or a question for her.
  const [panelOpen, setPanelOpen] = useState(false);
  // What Denise has that hasn't been looked at in her panel yet.
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());

  const [department, setDepartment] = useState<"all" | ServiceFamily>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // The tooltip for a short block: its details and where it is.
  const [hint, setHint] = useState<{ id: string; details: string[]; rect: DOMRect } | null>(null);
  // A drag of a repeating visit, waiting for "this / following / all".
  const [pendingMove, setPendingMove] = useState<{ move: Move; block: BlockData } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Blocked time being dragged or resized, and where moved blocks now are
  // until the calendar reloads.
  const [blockDrag, setBlockDrag] = useState<BlockDrag | null>(null);
  const [blockMoves, setBlockMoves] = useState<Record<string, { start: number; end: number }>>({});
  const [settling, setSettling] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // A drag ends with a click on the block; this stops it opening the panel.
  const justDragged = useRef(false);
  const columnRefs = useRef(new Map<string, HTMLElement>());

  // Moves show straight away and snap back if the server refuses them.
  const [moves, addMove] = useOptimistic<Record<string, Move>, Move>({}, (all, m) => ({ ...all, [m.itemId]: m }));

  // Minutes since midnight, when the day shown is today (for "running late").
  const now = useNow();
  const nowMinute = now !== null && toLocal(new Date(now), data.timeZone).date === data.date ? toLocal(new Date(now), data.timeZone).minute : null;

  const select = (next: Selection) => {
    setSelection(next);
    setTab("details");
    setPanelOpen(true);
  };

  // Shows Denise's latest view. A conflict or reorder she hasn't shown
  // before opens her panel at it; anything else new makes her badge bounce.
  // Reorders and waitlist openings already there when the calendar opens
  // just make her badge bounce; new ones while it's open open her panel.
  const seen = useRef(new Set<string>());
  const looked = useRef(false);
  const showDenise = useCallback((state: DeniseState, forData: BoardData) => {
    setDenise({ state, for: forData });
    const keys = deniseKeys(state);
    const fresh = keys.filter((k) => !seen.current.has(k));
    for (const k of keys) seen.current.add(k);
    const first = !looked.current;
    looked.current = true;
    if (fresh.length) setUnseen((all) => new Set([...all, ...fresh]));
    if (fresh.some((k) => k.startsWith("conflict:") || (!first && (k.startsWith("reorder:") || k.startsWith("opening:"))))) {
      setTab("denise");
      setPanelOpen(true);
    }
  }, []);

  // Denise looks again whenever the calendar changes.
  const scans = useRef(0);
  useEffect(() => {
    const id = ++scans.current;
    scanDenise(data.date).then((state) => {
      if (state && id === scans.current) showDenise(state, data);
    });
  }, [data, showDenise]);

  // Escape closes the panel (unless a menu or picker inside it is open).
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog], [role=listbox]")) return;
      setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  // Looking at Denise's panel clears what was new.
  if (panelOpen && tab === "denise" && unseen.size) setUnseen(new Set());

  const deniseState = denise && denise.state.date === data.date ? denise.state : null;
  const conflicts = (deniseState?.conflicts ?? []).filter((c) => !dismissed.has(c.subject));
  // How many things Denise wants looked at.
  const attention = conflicts.length + (deniseState?.notices.length ?? 0) + (deniseState?.reorders.length ?? 0) + (deniseState?.openings.length ?? 0);
  const scanning = denise?.for !== data;

  async function decide(run: () => Promise<FixResult>, undoActionId: string | null) {
    setDeciding(true);
    setOutcome(null);
    setPreview(null);
    const result = await run();
    setDeciding(false);
    if (result.state) showDenise(result.state, data);
    setOutcome({ message: result.message, error: !result.ok, undoActionId: result.ok ? undoActionId : null });
  }
  const approve = (o: FixView) => decide(() => approveDeniseFix(o.actionId!, data.date), o.actionId);
  const reject = (o: FixView) => decide(() => rejectDeniseFix(o.actionId!, data.date), null);
  const undo = (actionId: string) => decide(() => undoDeniseFix(actionId, data.date), null);

  async function ask(question: string) {
    const history: ChatMessage[] = [...chat, { role: "user", text: question }];
    setChat(history);
    setTab("denise");
    setPanelOpen(true);
    setAsking(true);
    const reply = await askDenise(history, data.date);
    setAsking(false);
    setChat([...history, reply]);
  }
  const onReported = (state: DeniseState) => {
    for (const k of [...seen.current]) if (k.startsWith("conflict:")) seen.current.delete(k);
    showDenise(state, data);
  };

  // The fix shown on the calendar: the one hovered in Denise's panel, or her
  // first suggestion. Blocks it's about glow; where they'd go shows dashed.
  const previewConflict = (preview && conflicts.find((c) => c.subject === preview.subject)) || conflicts[0] || null;
  const previewOption = previewConflict?.options[preview && previewConflict.subject === preview.subject ? preview.index : 0] ?? null;
  const highlighted = new Set(previewConflict?.itemIds ?? []);
  // Copies of the moved blocks at their new places, laid out with the
  // column's blocks so nothing overlaps.
  const fixGhosts = (staffId: string): Placed[] =>
    (previewOption?.moves ?? []).flatMap((m) => {
      const b = blocks.find((x) => x.itemId === m.itemId);
      if (!b || m.to.staffId !== staffId) return [];
      const shift = m.to.minute - b.start;
      return [{ ...b, itemId: `ghost:${b.itemId}`, staffId, start: b.start + shift, end: b.end + shift, segments: [], ghost: true, move: m }];
    });

  // Stylists who do any service in the chosen department.
  const offersFamily = (c: ColumnData, f: ServiceFamily) =>
    data.menu.services.some((s) => s.family === f && !s.archived && s.id in (data.menu.offers[c.staffId] ?? {}));
  const columns = department === "all" ? data.columns : data.columns.filter((c) => offersFamily(c, department));
  const departments = FAMILIES.filter((f) => data.columns.some((c) => offersFamily(c, f)));

  const placed = (b: BlockData): BlockData => {
    const m = moves[b.itemId];
    if (!m) return b;
    const shift = m.start - b.start;
    return { ...b, staffId: m.staffId, start: b.start + shift, end: b.end + shift, segments: b.segments.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })) };
  };
  const blocks = data.blocks.map(placed);
  const canMove = (b: BlockData) => me.canBook && isEditable(b.status);
  const selectedAppointment = selection.kind === "detail" || selection.kind === "edit" ? selection.appointmentId : null;
  const selectedGroup = selectedAppointment ? (data.appointments[selectedAppointment]?.group?.id ?? null) : null;

  // Off-duty stylists with nothing booked fold to a thin column.
  const collapsed = (c: ColumnData) => !c.working && !expanded.has(c.staffId) && !blocks.some((b) => b.staffId === c.staffId);
  const toggle = (staffId: string, show: boolean) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (show) next.add(staffId);
      else next.delete(staffId);
      return next;
    });

  function columnAt(clientX: number): string | null {
    for (const [staffId, el] of columnRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return staffId;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent, b: BlockData) {
    if (e.button !== 0 || !canMove(b)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      itemId: b.itemId,
      staffId: b.staffId,
      start: b.start,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      fromStaffId: b.staffId,
      fromStart: b.start,
      length: b.end - b.start,
      moved: false,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    const shift = Math.round(dy / PX_PER_MINUTE / MOVE_STEP) * MOVE_STEP;
    const start = Math.min(Math.max(d.fromStart + shift, range.start), range.end - d.length);
    const next = { ...d, moved: true, start, staffId: columnAt(e.clientX) ?? d.staffId };
    dragRef.current = next;
    setDrag(next);
  }

  function onPointerUp(e: React.PointerEvent, b: BlockData) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || e.pointerId !== d.pointerId || !d.moved) return;
    justDragged.current = true;
    if (d.staffId === d.fromStaffId && d.start === d.fromStart) return;
    const move = { itemId: d.itemId, staffId: d.staffId, start: d.start };
    // A repeating or group visit asks which visits to move first.
    if (b.series || b.group) return setPendingMove({ move, block: b });
    runMove(move, b, "this");
  }

  function runMove(move: Move, b: BlockData, scope: Scope | "group") {
    setNotice(null);
    setSettling(move.itemId);
    startTransition(async () => {
      addMove(move);
      const input = { itemId: move.itemId, staffId: move.staffId, date: data.date, startMinute: move.start };
      const result = scope === "this" ? await moveVisitItem(input) : scope === "group" ? await moveGroupVisit(input) : await moveVisitItemScoped(input, scope);
      if (!result.ok) setNotice(`Couldn't move ${b.clientName}'s ${b.service}: ${result.message}`);
      else if ((result as { message?: string }).message) setDoneMessage((result as { message?: string }).message!);
    });
  }

  // A click on empty calendar space closes the panel (and does nothing
  // else); with it closed, it starts a booking there (or, for stylists,
  // blocking their own time).
  function onSlotClick(e: React.MouseEvent<HTMLElement>, column: ColumnData) {
    if ((e.target as HTMLElement).closest("[data-block], [data-time-block]")) return;
    if (panelOpen) return setPanelOpen(false);
    const top = e.currentTarget.getBoundingClientRect().top;
    const minute = range.start + Math.floor((e.clientY - top) / PX_PER_MINUTE / SLOT_STEP) * SLOT_STEP;
    const start = { staffId: column.staffId, startMinute: Math.min(minute, range.end - SLOT_STEP) };
    if (me.canBook) select({ kind: "book", start });
    else if (column.staffId === me.staffId) select({ kind: "new-block", start });
  }

  // Whose time this person can block: anyone's for the front of house,
  // their own for stylists.
  const blockStaff = me.canBook ? data.columns.map((c) => c.staffId) : data.columns.some((c) => c.staffId === me.staffId) ? [me.staffId] : [];
  const canEditBlock = (b: TimeBlockData) => blockStaff.includes(b.staffId);
  const timeBlocks = data.timeBlocks.map((b) => ({ ...b, ...blockMoves[`${b.blockId}:${b.start}`] }));

  function onBlockPointerDown(e: React.PointerEvent, b: TimeBlockData, mode: "move" | "resize") {
    if (e.button !== 0 || !canEditBlock(b)) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setBlockDrag({ key: `${b.blockId}:${data.timeBlocks.find((x) => x.blockId === b.blockId)!.start}`, block: b, mode, pointerId: e.pointerId, y: e.clientY, start: b.start, end: b.end, moved: false });
  }

  function onBlockPointerMove(e: React.PointerEvent) {
    const d = blockDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
    const shift = Math.round(dy / PX_PER_MINUTE / MOVE_STEP) * MOVE_STEP;
    const length = d.block.end - d.block.start;
    const next =
      d.mode === "move"
        ? { start: Math.min(Math.max(d.block.start + shift, range.start), range.end - length), end: 0 }
        : { start: d.block.start, end: Math.min(Math.max(d.block.end + shift, d.block.start + MOVE_STEP), range.end) };
    if (d.mode === "move") next.end = next.start + length;
    setBlockDrag({ ...d, ...next, moved: true });
  }

  function onBlockPointerUp(e: React.PointerEvent) {
    const d = blockDrag;
    setBlockDrag(null);
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) return select({ kind: "block", blockId: d.block.blockId });
    if (d.start === d.block.start && d.end === d.block.end) return;
    setNotice(null);
    setBlockMoves((all) => ({ ...all, [d.key]: { start: d.start, end: d.end } }));
    startTransition(async () => {
      const result = await moveBlock({ blockId: d.block.blockId, staffId: d.block.staffId, date: data.date, startMinute: d.start, endMinute: d.end });
      if (!result.ok) {
        setNotice(`Couldn't move ${BLOCK_LABELS[d.block.kind].toLowerCase()}: ${result.message}`);
        setBlockMoves((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== d.key)));
      } else setDoneMessage(result.message);
    });
  }

  const gridColumns = {
    gridTemplateColumns: `4rem ${columns.map((c) => (collapsed(c) ? "2.75rem" : "minmax(8.5rem, 1fr)")).join(" ")}`,
  };
  const dayLink = (d: string) => (d === data.today ? "/calendar" : `/calendar?date=${d}`);
  const goTo = (d: string) => router.push(dayLink(d), { transitionTypes: [d > data.date ? "nav-forward" : "nav-back"] });
  const closeDetails = () => setSelection({ kind: "none" });

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-6 pb-4 sm:px-6 lg:min-h-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl font-semibold tracking-tight text-navy-900">Appointments</h1>
            <ViewTransition key={data.date} enter={DAY_SLIDE} exit="none" default="none">
              <p className="mt-1 text-lg text-ink-muted" data-testid="calendar-date">
                {formatLongDay(data.date)}
                <span className="ml-2 text-sm">
                  {data.date === data.today ? "Today · " : ""}
                  {data.openLabel}
                </span>
              </p>
            </ViewTransition>
          </div>
          <div className="flex flex-wrap gap-2">
          <Link href="/calendar/waitlist" className={buttonClass("ghost", "lg")}>
            Waitlist
          </Link>
          {me.canBook && (
            <button type="button" className={buttonClass("secondary", "lg")} onClick={() => select({ kind: "walk-ins" })}>
              Walk-ins
            </button>
          )}
          {blockStaff.length > 0 && (
            <button
              type="button"
              className={buttonClass("secondary", "lg")}
              onClick={() => select({ kind: "new-block", start: { staffId: blockStaff.includes(me.staffId) ? me.staffId : blockStaff[0], startMinute: 12 * 60 } })}
            >
              Block time
            </button>
          )}
          {me.canBook && (
            <button
              type="button"
              className={buttonClass("primary", "lg")}
              onClick={() => select({ kind: "book", start: { staffId: (columns.find((c) => c.working) ?? columns[0] ?? data.columns[0]).staffId, startMinute: range.start } })}
            >
              <PlusIcon className="size-5" />
              New booking
            </button>
          )}
          </div>
        </div>

        <AskDeniseBar onAsk={ask} />

        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Date" className="flex flex-wrap items-center gap-2">
            <Link href={dayLink(addDays(data.date, -1))} transitionTypes={["nav-back"]} aria-label="Previous day" title="Previous day" className={buttonClass("secondary", "md", "", { square: true })}>
              <ChevronLeftIcon />
            </Link>
            <Link href={dayLink(addDays(data.date, 1))} transitionTypes={["nav-forward"]} aria-label="Next day" title="Next day" className={buttonClass("secondary", "md", "", { square: true })}>
              <ChevronRightIcon />
            </Link>
            <Link
              href="/calendar"
              transitionTypes={[data.today > data.date ? "nav-forward" : "nav-back"]}
              aria-current={data.date === data.today ? "date" : undefined}
              className={buttonClass("secondary", "md")}
            >
              Today
            </Link>
            <DatePicker value={data.date} today={data.today} onChange={goTo} label="Go to date" />
          </nav>
          <Listbox
            label="Department"
            value={department}
            onChange={setDepartment}
            className="w-52"
            options={[
              { value: "all", label: "All departments" },
              ...departments.map((f) => ({
                value: f,
                label: FAMILY_LABELS[f],
                icon: (
                  <span data-family={f} aria-hidden className="h-3 w-3 shrink-0 rounded-[3px] border-l-[3px] border-(--fam-accent) bg-(--fam-fill)" />
                ),
              })),
            ]}
          />
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              label="View"
              value="day"
              onChange={() => {}}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week", disabled: true, title: "Week view is coming soon" },
              ]}
            />
          </div>
        </div>

        {doneMessage && (
          <div role="status" className="flex animate-fade-in items-start justify-between gap-4 rounded-md border border-status-confirmed-ink/25 bg-status-confirmed-bg px-3 py-2 text-sm text-status-confirmed-ink">
            <span>{doneMessage}</span>
            <button type="button" onClick={() => setDoneMessage(null)} className="font-semibold" aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {notice && (
          <div role="alert" className="flex animate-fade-in items-start justify-between gap-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="font-semibold" aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <ViewTransition key={data.date} enter={DAY_SLIDE} exit={DAY_SLIDE} default="none">
          <div className="overflow-auto rounded-xl border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1" data-testid="calendar-grid">
            {columns.length === 0 ? (
              <p className="p-6 text-ink-muted">No one in this department works here. Choose another department.</p>
            ) : (
              // Columns share the width; below their minimum the grid scrolls.
              <div className="min-w-fit">
                <div className="sticky top-0 z-30 grid border-b border-line bg-surface" style={gridColumns}>
                  <div className="sticky left-0 z-10 bg-surface" />
                  {columns.map((c) =>
                    collapsed(c) ? (
                      <button
                        key={c.staffId}
                        type="button"
                        aria-expanded={false}
                        aria-label={`Show ${c.name} (${c.hoursLabel.toLowerCase()})`}
                        title={`${c.name} · ${c.hoursLabel}`}
                        onClick={() => toggle(c.staffId, true)}
                        className="flex flex-col items-center justify-center gap-1 border-l border-line bg-sunken/60 py-3 text-xs font-semibold text-ink-muted transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                      >
                        {initials(c.name)}
                        <ChevronRightIcon className="size-3.5" />
                      </button>
                    ) : (
                      <div key={c.staffId} className="relative flex min-w-0 animate-fade-in items-center gap-2.5 border-l border-line px-3 py-3" data-level={c.level ?? undefined}>
                        {c.level && <span aria-hidden data-testid="level-bar" className={`absolute inset-x-0 top-0 h-[3px] ${LEVEL_BG[c.level]}`} />}
                        <Avatar name={c.name} color={c.color} level={c.level} />
                        <div className="min-w-0 flex-1">
                          <FitText variants={[c.name, `${c.firstName} ${c.name.split(" ").at(-1)![0]}.`, c.firstName]} className="pr-6 font-semibold" />
                          <div className="truncate text-sm text-ink-muted">{c.title}</div>
                          <div className="text-xs leading-4 text-ink-muted">{c.hoursLabel}</div>
                        </div>
                        {!c.working && expanded.has(c.staffId) && (
                          <IconButton label={`Hide ${c.name}`} size="sm" onClick={() => toggle(c.staffId, false)}>
                            <ChevronLeftIcon className="size-4" />
                          </IconButton>
                        )}
                        {c.working && data.date >= data.today && (me.canBook || me.staffId === c.staffId) && (
                          <div className="absolute top-1.5 right-1">
                            <OutMenu column={c} date={data.date} today={data.today} onReported={onReported} />
                          </div>
                        )}
                      </div>
                    ),
                  )}
                </div>

                <div className="relative grid" style={gridColumns} data-range-start={range.start}>
                  <div className="sticky left-0 z-20 bg-surface" style={{ height }} aria-hidden>
                    {hourMarks(range).map((m) => (
                      <span
                        key={m}
                        className={`absolute right-2 text-xs font-medium text-ink-muted ${m === range.start ? "translate-y-1" : "-translate-y-1/2"}`}
                        style={{ top: y(m) }}
                      >
                        {formatMinute(m)}
                      </span>
                    ))}
                  </div>

                  {columns.map((c) =>
                    collapsed(c) ? (
                      <section
                        key={c.staffId}
                        aria-label={c.name}
                        data-collapsed
                        onClick={() => toggle(c.staffId, true)}
                        className="cursor-pointer border-l border-line bg-sunken/80"
                        style={{ height, backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgb(23 39 59 / 0.04) 6px 12px)" }}
                      />
                    ) : (
                      <section
                        key={c.staffId}
                        ref={(el) => {
                          if (el) columnRefs.current.set(c.staffId, el);
                          else columnRefs.current.delete(c.staffId);
                        }}
                        aria-label={c.name}
                        data-staff-id={c.staffId}
                        onClick={(e) => onSlotClick(e, c)}
                        className={`relative min-w-0 border-l border-line transition-colors duration-(--motion-fast) ${me.canBook ? "cursor-cell" : ""} ${
                          drag?.moved && drag.staffId === c.staffId ? "bg-navy-100/40" : ""
                        }`}
                        style={{
                          height,
                          backgroundImage: `linear-gradient(to bottom, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--color-line) 50%, transparent) 1px, transparent 1px)`,
                          backgroundSize: `100% ${60 * PX_PER_MINUTE}px, 100% ${30 * PX_PER_MINUTE}px`,
                        }}
                      >
                        {c.offHours.map((o) => (
                          <div
                            key={o.start}
                            data-off-hours
                            aria-hidden
                            title="Not bookable"
                            className="absolute inset-x-0 bg-sunken/80"
                            style={{
                              top: y(o.start),
                              height: (o.end - o.start) * PX_PER_MINUTE,
                              backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgb(23 39 59 / 0.04) 6px 12px)",
                            }}
                          />
                        ))}

                        {c.timeOff.map((t) => (
                          <div
                            key={`${t.start}-${t.label}`}
                            data-time-off
                            className="absolute inset-x-1 z-0 rounded-md border border-line-strong bg-sunken px-2 py-1 text-xs font-medium text-ink-muted"
                            style={{ top: y(t.start), height: (t.end - t.start) * PX_PER_MINUTE }}
                          >
                            Time off: {t.label}
                            <span className="sr-only"> for {c.name}</span>
                          </div>
                        ))}

                        {timeBlocks
                          .filter((b) => b.staffId === c.staffId)
                          .map((b) => {
                            const live = blockDrag && blockDrag.block.blockId === b.blockId ? { ...b, start: blockDrag.start, end: blockDrag.end } : b;
                            return (
                              <TimeBlockBox
                                key={`${b.blockId}:${b.start}`}
                                block={live}
                                y={y}
                                editable={canEditBlock(b)}
                                dragging={blockDrag?.block.blockId === b.blockId && blockDrag.moved}
                                selected={selection.kind === "block" && selection.blockId === b.blockId}
                                columnName={c.name}
                                onPointerDown={onBlockPointerDown}
                                onPointerMove={onBlockPointerMove}
                                onPointerUp={onBlockPointerUp}
                                onPointerCancel={() => setBlockDrag(null)}
                                onOpen={() => select({ kind: "block", blockId: b.blockId })}
                              />
                            );
                          })}

                        {drag?.moved && drag.staffId === c.staffId && <DragGhost block={blocks.find((b) => b.itemId === drag.itemId)!} start={drag.start} y={y} />}


                        <ul aria-label={`${c.name}'s appointments`}>
                          {layoutColumn<Placed>([...blocks.filter((b) => b.staffId === c.staffId), ...fixGhosts(c.staffId)]).map((b) =>
                            b.ghost ? (
                              <FixGhost key={b.itemId} block={b} y={y} />
                            ) : (
                            <AppointmentBlock
                              key={b.itemId}
                              block={b}
                              y={y}
                              late={nowMinute !== null && (b.status === "booked" || b.status === "confirmed") && b.start <= nowMinute}
                              draggable={canMove(b)}
                              dragging={drag?.moved === true && drag.itemId === b.itemId}
                              selected={b.appointmentId === selectedAppointment}
                              highlight={highlighted.has(b.itemId)}
                              grouped={!!selectedGroup && b.group?.id === selectedGroup && b.appointmentId !== selectedAppointment}
                              stylist={data.columns.find((c) => c.staffId === b.staffId)?.name ?? ""}
                              onHint={(details, rect) => setHint(details && !dragRef.current ? { id: b.itemId, details, rect } : null)}
                              settling={settling === b.itemId}
                              onSettled={() => setSettling(null)}
                              onPointerDown={(e) => {
                                setHint(null);
                                onPointerDown(e, b);
                              }}
                              onPointerMove={onPointerMove}
                              onPointerUp={(e) => onPointerUp(e, b)}
                              onPointerCancel={() => {
                                dragRef.current = null;
                                setDrag(null);
                              }}
                              onOpen={() => {
                                if (justDragged.current) justDragged.current = false;
                                else select({ kind: "detail", appointmentId: b.appointmentId });
                              }}
                            />
                            ),
                          )}
                        </ul>
                      </section>
                    ),
                  )}

                  <div className="pointer-events-none absolute inset-y-0 right-0 left-16">
                    <NowLine date={data.date} timeZone={data.timeZone} startMinute={range.start} endMinute={range.end} pxPerMinute={PX_PER_MINUTE} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ViewTransition>

        {/* The legend, with Denise's face at the end of it while her panel
            is closed (so she never sits on top of the calendar). */}
        <div className="flex items-center gap-4">
          <Legend />
          <DeniseLauncher
            hidden={panelOpen}
            count={attention}
            bounce={unseen.size > 0}
            onOpen={() => {
              setTab("denise");
              setPanelOpen(true);
            }}
          />
        </div>
      </div>

      {hint && <BlockHint {...hint} />}

      {/* Denise and booking details: a panel that slides over the calendar
          when something opens it. */}
      <aside
        aria-label="Assistant and booking details"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-4 border-l border-line bg-surface p-4 shadow-panel transition-[transform,visibility] duration-(--motion-slow) ease-out sm:w-96 ${
          // Closed, it's hidden once it has slid away, so keyboard focus skips it.
          panelOpen ? "visible translate-x-0" : "invisible translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="font-serif text-lg font-semibold text-navy-900">{tab === "denise" ? "Denise" : "Booking details"}</span>
          <IconButton label="Close panel" className="ml-auto" onClick={() => setPanelOpen(false)}>
            <CloseIcon />
          </IconButton>
        </div>
        <Tabs
          label="Assistant"
          value={tab}
          onChange={setTab}
          panelKey={`${tab}-${selection.kind}-${"appointmentId" in selection ? selection.appointmentId : ""}`}
          tabs={[
            { value: "denise", label: "Denise", icon: <DeniseFace size={20} />, badge: <DeniseBadge count={attention} /> },
            { value: "details", label: "Booking details", icon: <CalendarIcon className="size-4" /> },
          ]}
        >
          {tab === "denise" ? (
            <DenisePanel
              data={data}
              state={deniseState && { ...deniseState, conflicts }}
              working={deciding || asking || (scanning && !deniseState)}
              outcome={outcome}
              chat={chat}
              preview={preview}
              onApprove={approve}
              onReject={reject}
              onUndo={undo}
              onDismiss={(subject) => setDismissed((all) => new Set(all).add(subject))}
              onPreview={setPreview}
              onAsk={ask}
              onOpen={(appointmentId) => select({ kind: "detail", appointmentId })}
              onBook={(actionId, clientId) => decide(() => approveDeniseFix(actionId, data.date, clientId), actionId)}
              onRejectSuggestion={(actionId) => decide(() => rejectDeniseFix(actionId, data.date), null)}
              onBookWaitlist={(o, m) => decide(() => bookFromWaitlist(m.entryId, o.staffId, data.date, m.startMinute), null)}
            />
          ) : selection.kind === "detail" && data.appointments[selection.appointmentId] ? (
            <AppointmentPanel
              date={data.date}
              today={data.today}
              timeZone={data.timeZone}
              appointment={data.appointments[selection.appointmentId]}
              me={me}
              onEdit={() => select({ kind: "edit", appointmentId: selection.appointmentId })}
              onClose={closeDetails}
              onReported={onReported}
              onOpenVisit={(appointmentId) => select({ kind: "detail", appointmentId })}
              products={data.menu.products}
            />
          ) : selection.kind === "walk-ins" ? (
            <WalkInPanel
              data={data}
              onClose={closeDetails}
              onBooked={(id, message) => {
                setDoneMessage(message);
                if (data.date === data.today) select({ kind: "detail", appointmentId: id });
                else closeDetails();
              }}
            />
          ) : selection.kind === "book" ? (
            <BookingPanel
              data={data}
              start={selection.start}
              onClose={closeDetails}
              onSaved={(id, message) => {
                select({ kind: "detail", appointmentId: id });
                if (message) setDoneMessage(message);
              }}
              onBlockInstead={blockStaff.includes(selection.start.staffId) ? () => select({ kind: "new-block", start: selection.start }) : undefined}
              onGroupInstead={() => select({ kind: "group", start: selection.start })}
            />
          ) : selection.kind === "group" ? (
            <GroupPanel
              data={data}
              start={selection.start}
              onClose={closeDetails}
              onSaved={(id, message) => {
                select({ kind: "detail", appointmentId: id });
                setDoneMessage(message);
              }}
            />
          ) : selection.kind === "new-block" || (selection.kind === "block" && data.timeBlocks.some((b) => b.blockId === selection.blockId)) ? (
            <BlockPanel
              key={selection.kind === "block" ? selection.blockId : "new"}
              date={data.date}
              columns={data.columns}
              staffChoices={blockStaff}
              block={selection.kind === "block" ? data.timeBlocks.find((b) => b.blockId === selection.blockId) : undefined}
              start={selection.kind === "new-block" ? selection.start : undefined}
              onClose={closeDetails}
              onDone={(message) => {
                closeDetails();
                setPanelOpen(false);
                setNotice(null);
                setBlockMoves({});
                setDoneMessage(message);
              }}
            />
          ) : selection.kind === "edit" && data.appointments[selection.appointmentId] ? (
            <BookingPanel
              data={data}
              appointment={data.appointments[selection.appointmentId]}
              onClose={() => select({ kind: "detail", appointmentId: selection.appointmentId })}
              onSaved={(_, message) => {
                select({ kind: "detail", appointmentId: selection.appointmentId });
                if (message) setDoneMessage(message);
              }}
            />
          ) : (
            <div className="flex flex-col gap-3 py-6 text-sm text-ink-muted">
              <p>Choose an appointment to see its details{me.canBook ? ", or click an empty time to book it." : "."}</p>
              {me.canBook && <p>Drag an appointment to move it.</p>}
            </div>
          )}
        </Tabs>
      </aside>

      {pendingMove && (
        <ScopeDialog
          title={`Move ${pendingMove.block.clientName}'s ${pendingMove.block.group ? "group" : "repeating"} visit`}
          note={pendingMove.block.group ? `This visit is part of ${pendingMove.block.group.label}.` : "This visit is part of a series."}
          options={[
            ["this", "This visit only"],
            ...(pendingMove.block.group ? [["group", "The whole group"] as const] : []),
            ...(pendingMove.block.series
              ? [
                  ["following", "This and following visits"] as const,
                  ["all", "All visits in the series"] as const,
                ]
              : []),
          ]}
          onPick={(scope) => {
            const p = pendingMove;
            setPendingMove(null);
            runMove(p.move, p.block, scope);
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}

    </div>
  );
}

// Everything Denise is showing, as stable keys, for spotting what's new.
function deniseKeys(state: DeniseState): string[] {
  return [
    ...state.conflicts.map((c) => `conflict:${c.subject}`),
    ...state.notices.map((n) => `notice:${n.id}`),
    ...state.reorders.map((r) => `reorder:${r.supplierId}:${r.headline}`),
    ...state.openings.map((o) => `opening:${o.key}:${o.matches.length}`),
  ];
}

function AskDeniseBar({ onAsk }: { onAsk: (question: string) => void }) {
  const [question, setQuestion] = useState("");
  return (
    <form
      aria-label="Ask Denise"
      className="flex items-center gap-3 rounded-xl border border-denise-200 bg-surface p-2 pl-2.5 shadow-card transition-[border-color,box-shadow] duration-(--motion-fast) focus-within:border-denise-500 focus-within:ring-2 focus-within:ring-denise-200"
      onSubmit={(e) => {
        e.preventDefault();
        if (!question.trim()) return;
        onAsk(question.trim());
        setQuestion("");
      }}
    >
      <DeniseFace size={36} />
      <label className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-semibold text-denise-700">Ask Denise</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Find a haircut with Priya after 1 PM"
          className="w-full bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
        />
      </label>
      <IconButton type="submit" label="Ask" variant="primary">
        <SendIcon className="size-5" />
      </IconButton>
    </form>
  );
}

// How many things Denise wants looked at, on her tab and button.
function DeniseBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span data-testid="denise-badge" className="inline-flex h-5 min-w-5 animate-pop-in items-center justify-center rounded-full bg-denise-600 px-1.5 text-xs font-semibold text-white">
      <span className="sr-only">, </span>
      {count}
      <span className="sr-only"> to look at</span>
    </span>
  );
}

// The icon on visits that are part of a group booking.
function GroupIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg role="img" aria-label="Group booking" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" />
    </svg>
  );
}

// The repeat icon on visits that are part of a series.
function RepeatIcon({ className = "size-4", label }: { className?: string; label?: string }) {
  return (
    <svg aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "This visit, the whole group, this and following, or all?" for a change
// to a repeating or group visit.
function ScopeDialog({
  title,
  note,
  options,
  onPick,
  onCancel,
}: {
  title: string;
  note: string;
  options: (readonly [Scope | "group", string])[];
  onPick: (scope: Scope | "group") => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/30 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="flex w-full max-w-sm animate-pop-in flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-lift"
      >
        <h2 className="font-serif text-xl font-semibold text-navy-900">{title}</h2>
        <p className="text-sm text-ink-muted">{note}</p>
        {options.map(([value, label], i) => (
          <Button key={value} variant={i === 0 ? "primary" : "secondary"} autoFocus={i === 0} onClick={() => onPick(value)}>
            {label}
          </Button>
        ))}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Denise's face in the corner while her panel is closed. Her badge counts
// what she wants looked at, and bounces gently when something is new.
function DeniseLauncher({ hidden, count, bounce, onOpen }: { hidden: boolean; count: number; bounce: boolean; onOpen: () => void }) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={count ? `Open Denise (${count} to look at)` : "Open Denise"}
      data-testid="denise-launcher"
      className="relative ml-auto flex size-11 shrink-0 animate-pop-in items-center justify-center rounded-full bg-surface shadow-card ring-1 ring-denise-200 transition-transform duration-(--motion-fast) hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95"
    >
      <DeniseFace size={38} />
      {count > 0 && (
        <span
          data-testid="denise-launcher-badge"
          data-bounce={bounce || undefined}
          aria-hidden
          className={`absolute -top-1 -right-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-denise-600 px-1.5 text-xs font-semibold text-white ring-2 ring-surface ${bounce ? "animate-soft-bounce" : ""}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// A short block's details, beside it on hover or focus: fixed to the
// window, so the calendar's scrolling and clipping don't cut it off.
function BlockHint({ id, details, rect }: { id: string; details: string[]; rect: DOMRect }) {
  const above = rect.top > 120;
  return (
    <div
      id={`hint-${id}`}
      role="tooltip"
      data-testid="block-hint"
      className="pointer-events-none fixed z-[60] max-w-72 animate-fade-in rounded-lg bg-navy-900 px-3 py-2 text-xs leading-5 text-white shadow-lift"
      style={{ left: Math.min(rect.left, window.innerWidth - 300), ...(above ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) }}
    >
      <p className="text-sm font-semibold">{details[0]}</p>
      {details.slice(1).filter(Boolean).map((d) => (
        <p key={d}>{d}</p>
      ))}
    </div>
  );
}

// "Out for the day" on a stylist's column.
function OutMenu({ column, date, today, onReported }: { column: ColumnData; date: string; today: string; onReported: (state: DeniseState) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const restOfDay = date === today;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  async function markOut() {
    setPending(true);
    setError(null);
    const result = await reportOut(column.staffId, date);
    setPending(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    onReported(result.state);
  }

  return (
    <div ref={root} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <IconButton label={`More for ${column.name}`} size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MoreIcon className="size-4" />
      </IconButton>
      {open && (
        <div role="dialog" aria-label={`${column.firstName}'s day`} className="absolute top-full right-0 z-50 mt-1 flex w-64 origin-top-right animate-pop-in flex-col gap-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-lift">
          <p className="text-ink">
            Mark {column.firstName} out {restOfDay ? "for the rest of the day" : "for the day"}? Denise will find new places for {column.firstName}&apos;s clients.
          </p>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={pending} onClick={markOut}>
              {restOfDay ? "Out for the rest of the day" : "Out for the day"}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Where Denise's fix would put a block: a dashed periwinkle outline in its
// own lane.
function FixGhost({ block, y }: { block: Placed & { lane: number; lanes: number }; y: (minute: number) => number }) {
  const box = laneBox(block.lane, block.lanes);
  const [first, ...rest] = block.clientName.split(" ");
  const length = block.end - block.start;
  return (
    <li aria-hidden className="contents">
      <div
        data-fix-ghost
        className="pointer-events-none absolute z-30 animate-fade-in overflow-hidden rounded-md border-2 border-dashed border-denise-500 bg-denise-50 px-1.5 py-0.5"
        style={{
          top: y(block.start),
          height: length * PX_PER_MINUTE,
          left: `calc(${box.left}% + ${block.lane > 0 ? 1 : 3}px)`,
          width: `calc(${box.width}% - ${block.lanes > 1 ? 4 : 6}px)`,
        }}
      >
        {length * PX_PER_MINUTE >= 40 && (
          <FitText variants={[block.clientName, ...(rest.length ? [first] : [])]} className="text-sm leading-[18px] font-semibold text-denise-900" />
        )}
        <FitText
          variants={[`→ ${formatMinute(block.start)}–${formatMinute(block.end)}`, `→ ${formatMinute(block.start)}`]}
          className="text-[13px] leading-[17px] text-denise-700"
        />
      </div>
    </li>
  );
}

function Legend() {
  return (
    <ul aria-label="Service families" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
      {FAMILIES.filter((f) => f !== "other").map((f) => (
        <li key={f} className="flex items-center gap-2" data-family={f}>
          <span aria-hidden className="h-3.5 w-5 rounded-[3px] border-l-[3px] border-(--fam-accent) bg-(--fam-fill)" />
          {FAMILY_LABELS[f]}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-3.5 w-5 rounded-[3px] border border-line-strong"
          style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, rgb(23 39 59 / 0.18) 3px 6px)" }}
        />
        Processing (stylist free)
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-3.5 w-5 rounded-[3px] bg-sunken ring-1 ring-line-strong" />
        Not bookable
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden data-family="cut" className="h-3.5 w-5 rounded-[3px] border-l-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--fam-fill) 40%, white)", borderColor: "color-mix(in srgb, var(--fam-accent) 45%, white)" }} />
        Checked out
      </li>
      {/* Stylist levels: the ring around each avatar and the bar on top of
          their column. */}
      <li className="flex items-center gap-2" data-testid="level-legend">
        <span className="sr-only">Stylist levels:</span>
        {[...STAFF_LEVELS].reverse().map((l) => (
          <span key={l} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-3 rounded-full border-2 ${LEVEL_BORDER[l]}`} />
            {LEVEL_LABELS[l]}
          </span>
        ))}
      </li>
    </ul>
  );
}

// Background for a block's parts: the family fill, lighter while processing,
// and lighter again once the visit is over.
function segmentStyle(kind: string, faded: boolean): React.CSSProperties {
  const strength = faded ? (kind === "processing" ? 25 : 40) : kind === "processing" ? 45 : 100;
  return {
    backgroundColor: strength === 100 ? "var(--fam-fill)" : `color-mix(in srgb, var(--fam-fill) ${strength}%, white)`,
    ...(kind === "processing"
      ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--fam-accent) 14%, transparent) 6px 12px)" }
      : {}),
  };
}

// Blocked time in a stylist's column: neutral, under appointments, and
// not bookable. Drag to move it; drag its bottom edge to resize.
function TimeBlockBox({
  block,
  y,
  editable,
  dragging,
  selected,
  columnName,
  onOpen,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  block: TimeBlockData;
  y: (minute: number) => number;
  editable: boolean;
  dragging: boolean;
  selected: boolean;
  columnName: string;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent, b: TimeBlockData, mode: "move" | "resize") => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}) {
  const height = (block.end - block.start) * PX_PER_MINUTE;
  const time = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const label = [BLOCK_LABELS[block.kind], time, block.note, block.weekdays && repeatLabel(block.weekdays).toLowerCase(), columnName].filter(Boolean).join(", ");
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      data-time-block={block.kind}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      onClick={editable ? undefined : onOpen}
      onPointerDown={(e) => onPointerDown(e, block, "move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`absolute inset-x-1 z-[5] touch-none overflow-hidden rounded-md border border-dashed border-line-strong px-2 py-1 text-xs text-ink-muted select-none transition-[box-shadow] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-focus ${
        editable ? "cursor-grab" : "cursor-pointer"
      } ${selected ? "ring-2 ring-navy-900" : ""} ${dragging ? "z-40 shadow-lift" : ""}`}
      style={{
        top: y(block.start),
        height,
        backgroundColor: "var(--color-sunken)",
        backgroundImage: "repeating-linear-gradient(45deg, transparent 0 5px, rgb(23 39 59 / 0.05) 5px 10px)",
      }}
    >
      {height >= 18 && (
        <span className="flex items-center gap-1 font-semibold text-ink">
          {block.weekdays && (
            <svg aria-hidden viewBox="0 0 24 24" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {BLOCK_LABELS[block.kind]}
          {height >= 34 ? null : <span className="font-normal text-ink-muted"> · {time}</span>}
        </span>
      )}
      {height >= 34 && <span className="block truncate">{time}</span>}
      {height >= 50 && block.note && <span className="block truncate">{block.note}</span>}
      {editable && (
        <span
          aria-hidden
          data-resize-handle
          onPointerDown={(e) => onPointerDown(e, block, "resize")}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
        />
      )}
    </div>
  );
}

// A lifted copy of the block that follows the pointer while dragging.
function DragGhost({ block, start, y }: { block: BlockData; start: number; y: (minute: number) => number }) {
  const length = block.end - block.start;
  return (
    <div
      data-drag-ghost
      data-family={block.family}
      aria-hidden
      className="pointer-events-none absolute inset-x-1 z-40 scale-[1.02] overflow-hidden rounded-md border-l-4 border-(--fam-accent) bg-(--fam-fill) px-2 py-1 text-sm shadow-lift"
      style={{ top: y(start), height: length * PX_PER_MINUTE }}
    >
      <div className="truncate font-semibold">{block.clientName}</div>
      <div className="truncate text-[13px] text-ink-muted">
        {formatMinute(start)}–{formatMinute(start + length)}
      </div>
    </div>
  );
}

// States that need the front desk's attention get a chip on the block.
type Attention = "checked_in" | "confirmed" | "late" | "no_show";

const ATTENTION: Record<Attention, { label: string; className: string }> = {
  checked_in: { label: "Checked in", className: "bg-status-checked-in-bg text-status-checked-in-ink" },
  confirmed: { label: "Confirmed", className: "bg-status-confirmed-bg text-status-confirmed-ink" },
  late: { label: "Running late", className: "bg-status-late-bg text-status-late-ink" },
  no_show: { label: "No-show", className: "bg-status-no-show-bg text-status-no-show-ink" },
};

// Line heights in a block, in px.
const NAME_LINE = 18;
const LINE = 17;
const CHIP_LINE = 26;

function AppointmentBlock({
  block,
  y,
  late,
  draggable,
  dragging,
  selected,
  highlight,
  grouped,
  stylist,
  onHint,
  settling,
  onSettled,
  onOpen,
  ...pointer
}: {
  block: BlockData & { lane: number; lanes: number };
  y: (minute: number) => number;
  late: boolean;
  draggable: boolean;
  dragging: boolean;
  selected: boolean;
  // Denise is talking about it.
  highlight: boolean;
  // In the same group booking as the selected visit.
  grouped: boolean;
  // The stylist's name, for the tooltip.
  stylist: string;
  // Shows (or, with null, hides) the tooltip of details the block can't fit.
  onHint: (details: string[] | null, rect: DOMRect) => void;
  settling: boolean;
  onSettled: () => void;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}) {
  const time = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const processing = block.segments.find((s) => s.kind === "processing");
  const height = (block.end - block.start) * PX_PER_MINUTE;
  const box = laneBox(block.lane, block.lanes);
  // A side lane (a client in another's processing gap) is narrow: first name
  // and initial only.
  const narrow = block.lane > 0;
  const faded = block.status === "completed" || block.status === "no_show";
  const attention: Attention | null = block.status === "checked_in" ? "checked_in" : block.status === "no_show" ? "no_show" : late ? "late" : block.status === "confirmed" ? "confirmed" : null;

  // Only lines that fit whole: name, service, time, then the chip on its own
  // line if there's room (otherwise a dot beside the name).
  let room = height - 6;
  const show = { name: room >= NAME_LINE, service: false, time: false, chipLine: false, serviceLines: 1 as 1 | 2 };
  if (show.name) room -= NAME_LINE;
  if (room >= LINE) {
    show.service = true;
    room -= LINE;
  }
  if (room >= LINE) {
    show.time = true;
    room -= LINE;
  }
  if (attention && room >= CHIP_LINE && !narrow) {
    show.chipLine = true;
    room -= CHIP_LINE;
  }
  // Leftover room lets a long service name wrap rather than shorten.
  if (show.service && room >= LINE) show.serviceLines = 2;
  // A short block puts the time on the name line.
  const timeOnName = show.name && !show.time;

  // Shorter forms for narrow spaces, longest first.
  const [first, ...rest] = block.clientName.split(" ");
  const shortNames = [block.clientName, ...(rest.length ? [`${first} ${rest.at(-1)![0]}.`, first] : []), initials(block.clientName)];
  const startTime = formatMinute(block.start);
  // On a short block: the name and time, shortening the name first, then
  // initials alone in a very narrow lane; an ellipsis if even that won't fit.
  const names = timeOnName
    ? [...new Set([`${block.clientName} · ${time}`, ...shortNames.slice(0, -1).map((n) => `${n} · ${startTime}`), `${initials(block.clientName)} · ${startTime}`, initials(block.clientName)])]
    : shortNames;
  // Everything about the visit, for the tooltip when the block hides some.
  const hidden = timeOnName || !show.service || narrow;
  const details = [
    block.clientName,
    [block.service, block.with.length > 0 && `with ${block.with.join(" and ")}`].filter(Boolean).join(" · "),
    `${time} · ${stylist}`,
    [STATUS_LABELS[block.status], late && "running late", block.group && block.group.label, block.series && "repeating"].filter(Boolean).join(" · "),
  ];
  const plainService = block.service.replace(/\s*\([^)]*\)/g, "");
  const services = [
    ...new Set([
      ...(block.group ? [`${block.service} · ${block.group.label}`] : []),
      ...(block.with.length ? [`${block.service} · with ${block.with.join(", ")}`] : []),
      block.service,
      plainService,
    ]),
  ];
  const times = [time, formatMinute(block.start)];

  const label = [
    time,
    block.clientName,
    block.service,
    processing && `processing ${formatMinute(processing.start)}–${formatMinute(processing.end)}`,
    block.with.length > 0 && `with ${block.with.join(" and ")}`,
    block.resource,
    block.series && "repeating",
    block.group && `group: ${block.group.label}`,
    STATUS_LABELS[block.status],
    late && "running late",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="contents">
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={selected}
        data-block
        data-family={block.family}
        data-faded={faded || undefined}
        data-denise-highlight={highlight || undefined}
        data-group-highlight={grouped || undefined}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        onAnimationEnd={settling ? onSettled : undefined}
        onMouseEnter={(e) => hidden && onHint(details, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={(e) => onHint(null, e.currentTarget.getBoundingClientRect())}
        onFocus={(e) => hidden && onHint(details, e.currentTarget.getBoundingClientRect())}
        onBlur={(e) => onHint(null, e.currentTarget.getBoundingClientRect())}
        aria-describedby={hidden ? `hint-${block.itemId}` : undefined}
        {...pointer}
        className={`absolute block touch-none overflow-hidden rounded-md border-l-4 bg-surface text-left select-none transition-[transform,box-shadow,opacity] duration-(--motion-fast) ease-out hover:z-30 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
          faded ? "text-ink-muted" : "text-ink shadow-card"
        } ${selected || highlight || grouped ? "" : "ring-1 ring-surface"} ${draggable ? "cursor-grab" : "cursor-pointer"} ${
          dragging ? "opacity-40 shadow-none outline-2 outline-ink-subtle outline-dashed" : ""
        } ${settling ? "animate-settle" : ""}`}
        style={{
          top: y(block.start),
          height,
          left: `calc(${box.left}% + ${block.lane > 0 ? 1 : 3}px)`,
          width: `calc(${box.width}% - ${block.lanes > 1 ? 4 : 6}px)`,
          zIndex: 10 + block.lane,
          borderLeftColor: faded ? "color-mix(in srgb, var(--fam-accent) 45%, white)" : "var(--fam-accent)",
        }}
      >
        {block.segments.map((s) => (
          <span
            key={s.kind}
            aria-hidden
            data-segment={s.kind}
            className="absolute inset-x-0"
            style={{ top: (s.start - block.start) * PX_PER_MINUTE, height: (s.end - s.start) * PX_PER_MINUTE, ...segmentStyle(s.kind, faded) }}
          />
        ))}
        {/* The selection (and Denise's or a group's outline) is drawn inside
            the block, over its segments, so it never covers a neighbor. */}
        {(selected || highlight || grouped) && (
          <span
            aria-hidden
            data-ring={selected ? "selected" : highlight ? "denise" : "group"}
            className={`pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-inset ${selected ? "ring-navy-900" : highlight ? "animate-glow ring-denise-500" : "ring-navy-700/50"}`}
          />
        )}
        {show.name && (
          <span aria-hidden className={`relative flex items-center gap-1.5 pt-1 ${narrow ? "px-1.5" : "px-2"}`}>
            {block.group && <GroupIcon className="size-3.5 shrink-0" />}
            {block.series && <RepeatIcon className="size-3 shrink-0" label="Repeating" />}
            <FitText variants={names} className="flex-1 text-sm leading-[18px] font-semibold" />
            {attention && !show.chipLine && <span data-attention={attention} title={ATTENTION[attention].label} className={`size-2.5 shrink-0 rounded-full ${ATTENTION[attention].className}`} style={{ backgroundColor: "currentColor" }} />}
          </span>
        )}
        {show.service && (
          <span aria-hidden className={`relative block ${narrow ? "px-1.5" : "px-2"}`}>
            <FitText variants={services} lines={show.serviceLines} className="text-[13px] leading-[17px] text-ink-muted" />
          </span>
        )}
        {show.time && (
          <span aria-hidden className={`relative block ${narrow ? "px-1.5" : "px-2"}`}>
            <FitText variants={times} className="text-[13px] leading-[17px] text-ink-muted" />
          </span>
        )}
        {show.chipLine && attention && (
          <span aria-hidden className="relative mt-1 block px-2">
            <span data-attention={attention} className={`inline-block rounded-full px-2 text-xs leading-5 font-semibold ${ATTENTION[attention].className}`}>
              {ATTENTION[attention].label}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}
