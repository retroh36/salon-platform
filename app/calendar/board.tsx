"use client";

import { toastActionClass, toastClass } from "@/components/ui/feedback";
import Link from "next/link";
import { useLeaveGuard } from "@/components/unsaved";
import { formatDuration } from "@/lib/duration";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createContext, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useOptimistic, useRef, useState, ViewTransition } from "react";
import { fitCookie, mergeOrder, moveItem, nameVariants, offColumns, viewColumns, viewCookie, viewKey, type ViewKey } from "@/lib/calendar-views";
import { DeniseFace } from "@/components/denise";
import { Avatar } from "@/components/ui/avatar";
import { LEVEL_BG, LevelBadge } from "@/components/ui/level";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FitText } from "@/components/ui/fit-text";
import { CalendarIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, CloseIcon, GripIcon, MoreIcon, PlusIcon, SlidersIcon } from "@/components/ui/icons";
import { Listbox } from "@/components/ui/listbox";
import { Segmented } from "@/components/ui/segmented";
import { Tabs } from "@/components/ui/tabs";
import { isEditable, STATUS_LABELS } from "@/lib/appointments";
import type { DeniseRequest, DeniseState, FixMove, FixResult, FixView } from "@/lib/denise/types";
import { FAMILIES, FAMILY_LABELS, laneBox, layoutColumn, NOT_ARRIVED_MINUTES, quarterMarks, summaryVariants, timeRangeVariants, ZOOM_LABELS, ZOOM_PX_PER_MINUTE, ZOOMS, type CalendarZoom, type ServiceFamily } from "@/lib/calendar";
import { LEVEL_LABELS, STAFF_LEVELS } from "@/lib/schedule-forms";
import { BLOCK_LABELS } from "@/lib/scheduling/blocks";
import { formatLongDay } from "@/lib/schedule-format";
import { addDays, formatMinute, toLocal } from "@/lib/scheduling/time";
import { calendarStamp, changeVisitStatus, type ClientOption, moveGroupVisit, saveCalendarZoom, moveVisitItem, moveVisitItemScoped, undoVisitCheckIn, undoVisitNoShow } from "./actions";
import type { Scope } from "@/lib/scheduling/series";
import { moveBlock } from "./block-actions";
import { BlockPanel, repeatLabel } from "./block-panel";
import { AppointmentPanel } from "./appointment-panel";
import { approveDeniseFix, bookFromWaitlist, dismissDeniseItem, rejectDeniseFix, scanDenise, undoDeniseFix } from "./denise-actions";
import { appendDenise, askDenise, focusDenise, hydrateDenise, startDenise, takeAdjust, useDenise } from "@/components/denise-chat/store";
import { useDeniseShortcut } from "@/components/denise-chat/bubble";
import { DeniseChat } from "@/components/denise-chat/chat";
import { DenisePanel, type Outcome, type Preview } from "./denise-panel";
import { BookingPanel, type BookingDraft, type BookingStart } from "./booking-panel";
import { NewSaleLink } from "@/components/new-sale-link";
import { WalkInPanel } from "./walk-in-panel";
import { GroupPanel } from "./group-panel";
import { NowLine, useNow } from "./now-line";
import { OffChip, ViewEditor, type Department } from "./views";
import { saveCalendarView, setCalendarOrder } from "./view-actions";
import type { AppointmentDetail, BlockData, BoardData, ColumnData, TimeBlockData } from "./types";
import { firstLetter } from "@/lib/initial";
import { useKeepOnScreen } from "@/components/ui/keep-on-screen";

// How tall time is drawn (px per minute), from the zoom; blocks read it.
const ScaleContext = createContext(ZOOM_PX_PER_MINUTE.comfortable);
const usePpm = () => useContext(ScaleContext);
// Pinch distance (as a ratio) and ctrl + scroll travel for one zoom step.
const PINCH_STEP = 1.3;
const WHEEL_STEP = 60;
// How long "Undo" stays on the toast after a check-in or a no-show.
const UNDO_MS = 10_000;
// Moves snap to 5 minutes; a click on an empty slot to the quarter hour.
const MOVE_STEP = 5;
const SLOT_STEP = 15;
// Pointer travel before a press counts as a drag rather than a click.
const DRAG_THRESHOLD = 5;
// On a touchscreen a swipe scrolls the calendar, even from a block; holding
// a block still this long picks it up to drag (a finger moved sooner is a
// swipe). Mouse and pen drag at once.
const LONG_PRESS_MS = 350;
// While a touch drag is on, the page doesn't scroll under the finger.
const stopScroll = (e: TouchEvent) => e.preventDefault();
// Dragging near the grid's left or right edge scrolls it sideways (many
// columns): how close, in px, and how far each move scrolls at most.
const EDGE_ZONE = 72;
const EDGE_STEP = 24;
// A column's narrowest before the grid scrolls sideways, and with Fit all.
const COLUMN_MIN = "9.5rem";
// Remembered for a year, on this device.
const COOKIE_AGE = 60 * 60 * 24 * 365;

type Selection =
  | { kind: "none" }
  | { kind: "block"; blockId: string }
  | { kind: "new-block"; start: { staffId: string; startMinute: number } }
  | { kind: "book"; start: BookingStart; client?: ClientOption; draft?: BookingDraft }
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
  // Where it was grabbed, px below the block's top: it stays under the pointer there.
  grab: number;
  fromStaffId: string;
  fromStart: number;
  length: number;
  moved: boolean;
};

const LIVE_CHECK_MS = 20_000;
// How close (px) an hour label can be to the current-time pill.
const NOW_PILL_CLEARANCE = 18;

// Day changes slide forward or back; other updates don't animate.
const DAY_SLIDE = { "nav-forward": "day-forward", "nav-back": "day-back", default: "none" };

export function CalendarBoard({ data }: { data: BoardData }) {
  const { range, me } = data;
  const router = useRouter();
  // Zoom: Compact, Comfortable (the default) or Detailed, remembered for
  // this person; pinching the grid on an iPad steps through them.
  const [zoom, setZoomState] = useState<CalendarZoom>(me.zoom);
  const PX_PER_MINUTE = ZOOM_PX_PER_MINUTE[zoom];
  const gridRef = useRef<HTMLDivElement>(null);
  // The minute to keep in place while zooming (the middle of the view).
  const zoomAnchor = useRef<number | null>(null);
  const setZoom = (next: CalendarZoom) => {
    if (next === zoom) return;
    const el = gridRef.current;
    if (el) zoomAnchor.current = range.start + (el.scrollTop + el.clientHeight / 2 - headerHeight(el)) / PX_PER_MINUTE;
    setZoomState(next);
    startTransition(() => saveCalendarZoom(next));
  };
  const height = (range.end - range.start) * PX_PER_MINUTE;
  const y = (minute: number) => (minute - range.start) * PX_PER_MINUTE;
  usePinchZoom(gridRef, zoom, setZoom);
  // After a zoom, the same time stays in the middle of the view.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || zoomAnchor.current === null) return;
    el.scrollTop = (zoomAnchor.current - range.start) * PX_PER_MINUTE + headerHeight(el) - el.clientHeight / 2;
    zoomAnchor.current = null;
  }, [PX_PER_MINUTE, range.start]);
  // Opening today: now sits about a third of the way down.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || data.date !== data.today) return;
    const minute = toLocal(new Date(), data.timeZone).minute;
    if (minute < range.start || minute >= range.end) return;
    el.scrollTop = Math.max(0, (minute - range.start) * PX_PER_MINUTE - (el.clientHeight - headerHeight(el)) / 3);
    // Only when a day opens, not on every zoom or refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.date]);

  // What the right panel shows; it resets when the day changes.
  const [shownDate, setShownDate] = useState(data.date);
  // A link from the Dashboard can ask for a booking, a stylist's column or
  // Denise's panel (data.focus).
  const linked = data.focus.appointmentId && data.appointments[data.focus.appointmentId] ? data.focus.appointmentId : null;
  // "Book" on a client's profile: a new booking for them, open on arrival.
  const [selection, setSelection] = useState<Selection>(
    linked ? { kind: "detail", appointmentId: linked } : data.focus.book ? { kind: "book", start: data.focus.book.start, client: data.focus.book.client } : { kind: "none" },
  );
  // Denise: her view of the day (for the board's data she last looked at),
  // and what she's doing.
  const [denise, setDenise] = useState<{ state: DeniseState; for: BoardData } | null>(null);
  const [deciding, setDeciding] = useState(false);
  // A question or a report she's working on, streamed, and the
  // conversation, shared with her bubble on other pages
  // (components/denise-chat/store.ts).
  const { run: deniseRun, focus: deniseFocus, adjust } = useDenise();
  useEffect(() => hydrateDenise(me.staffId), [me.staffId]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Conflicts with nothing to approve, dismissed for now.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // A visit just moved to another day: opened when the calendar gets there.
  const [arriving, setArriving] = useState<string | null>(null);
  const arrived = arriving && data.appointments[arriving] ? arriving : null;
  if (shownDate !== data.date) {
    setShownDate(data.date);
    setSelection(arrived ? { kind: "detail", appointmentId: arrived } : { kind: "none" });
    setArriving(null);
    setOutcome(null);
    setPreview(null);
  }
  const [tab, setTab] = useState<Tab>(linked || data.focus.book ? "details" : "denise");
  // The panel is closed until something opens it: a booking, a new
  // booking, Denise spotting something, or a question for her.
  const [panelOpen, setPanelOpen] = useState(Boolean(linked || data.focus.book || data.focus.denise || data.focus.ask));
  // What Denise has that hasn't been looked at in her panel yet.
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());

  // Who's shown: everyone, a department or a saved view (the last used on
  // this device), with or without the people off that day; and Fit all.
  const [view, setViewState] = useState<ViewKey>(data.initialView);
  const [showOff, setShowOff] = useState(false);
  const [fitAll, setFitAllState] = useState(me.fitAll);
  const remember = (name: string, value: string) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_AGE}; samesite=lax`;
  };
  const setView = (next: ViewKey) => {
    setViewState(next);
    remember(viewCookie(me.staffId), next);
  };
  const setFitAll = (on: boolean) => {
    setFitAllState(on);
    remember(fitCookie(me.staffId), on ? "1" : "0");
  };
  // The view being made or changed (null: a new one).
  const [editing, setEditing] = useState<{ viewId: string | null } | null>(null);
  // A column header being dragged to a new place, and the order shown
  // while the new one saves.
  const [columnDrag, setColumnDrag] = useState<{ staffId: string; to: number } | null>(null);
  const [savedOrder, setSavedOrder] = useOptimistic<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  // Just checked in or marked a no-show: a toast with Undo, for UNDO_MS.
  const [undoable, setUndoable] = useState<{ kind: "check_in" | "no_show"; appointmentId: string; name: string; at: number } | null>(null);
  useEffect(() => {
    if (!undoable) return;
    const timer = setTimeout(() => setUndoable(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undoable]);
  const offerUndo = (kind: "check_in" | "no_show", appointmentId: string, name?: string) =>
    setUndoable({ kind, appointmentId, name: name ?? data.appointments[appointmentId]?.client?.name.split(" ")[0] ?? "The client", at: Date.now() });
  // The tooltip for a short block: its details and where it is.
  const [hint, setHint] = useState<{ id: string; details: string[]; rect: DOMRect } | null>(null);
  // A drag of a repeating visit, waiting for "this / following / all".
  const [pendingMove, setPendingMove] = useState<{ move: Move; block: BlockData } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Blocked time being dragged or resized, and where moved blocks now are
  // until the calendar reloads.
  const [blockDrag, setBlockDrag] = useState<BlockDrag | null>(null);
  // A touch on a block, waiting to see if it's held (a drag) or moves (a
  // swipe that scrolls).
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number; armed: boolean } | null>(null);
  function startPress(e: React.PointerEvent, onArm: () => void) {
    endPress();
    const p = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, armed: false, timer: 0 };
    p.timer = window.setTimeout(() => {
      p.armed = true;
      document.addEventListener("touchmove", stopScroll, { passive: false });
      onArm();
    }, LONG_PRESS_MS);
    press.current = p;
  }
  // "wait" until it's held, "swipe" once it moved first (the drag is off).
  function pressState(e: React.PointerEvent): "none" | "wait" | "swipe" | "armed" {
    const p = press.current;
    if (!p || e.pointerId !== p.pointerId) return "none";
    if (p.armed) return "armed";
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return "wait";
    endPress();
    return "swipe";
  }
  function endPress() {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    if (press.current.armed) document.removeEventListener("touchmove", stopScroll);
    press.current = null;
  }
  useEffect(() => endPress, []);
  const [blockMoves, setBlockMoves] = useState<Record<string, { start: number; end: number }>>({});
  const [settling, setSettling] = useState<string | null>(null);
  // A stylist's column a link asked for, tinted for a moment.
  const [focusedStaff, setFocusedStaff] = useState<string | null>(data.focus.staffId);
  const dragRef = useRef<Drag | null>(null);
  // While dragging: the element blocks are placed in (its top is the
  // day's first minute, wherever the day is scrolled) and the pointer's
  // last place, so a scroll under a still pointer moves the block too.
  const dragOrigin = useRef<HTMLElement | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Loads the day again when the calendar changes elsewhere (another desk,
  // or a client booking online): checks every 20 seconds while the tab is
  // in view, and when it comes back into view. Never mid-drag.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || dragRef.current) return;
      // Offline, this check is skipped; the next one tries again.
      const now = await calendarStamp().catch(() => null);
      if (!stopped && now && now !== data.stamp) router.refresh();
    };
    const timer = window.setInterval(check, LIVE_CHECK_MS);
    document.addEventListener("visibilitychange", check);
    // And once whenever new data arrives: a reload that started before a
    // save can land after the save's own, putting the old day back, and
    // this loads the saved one again at once rather than 20 seconds on.
    check();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [data.stamp, router]);
  // A drag ends with a click on the block; this stops it opening the panel.
  const justDragged = useRef(false);
  const columnRefs = useRef(new Map<string, HTMLElement>());

  // Moves show straight away and snap back if the server refuses them.
  const [moves, addMove] = useOptimistic<Record<string, Move>, Move>({}, (all, m) => ({ ...all, [m.itemId]: m }));

  // Minutes since midnight, when the day shown is today (for "running late").
  const now = useNow();
  const nowMinute = now !== null && toLocal(new Date(now), data.timeZone).date === data.date ? toLocal(new Date(now), data.timeZone).minute : null;

  // The pill is about 20px tall, centered on the line; a label is too.
  const nowHides = (mark: number) => nowMinute !== null && nowMinute >= range.start && nowMinute < range.end && Math.abs(mark - nowMinute) * PX_PER_MINUTE < NOW_PILL_CLEARANCE;

  // Anything that would throw away a half-filled form in the panel asks
  // first; `show` is for what a form does itself (after saving, say).
  const guard = useLeaveGuard();
  const { leave } = guard;
  const show = (next: Selection) => {
    setSelection(next);
    setTab("details");
    setPanelOpen(true);
  };
  const select = (next: Selection) => leave(() => show(next));

  // Shows Denise's latest view. A conflict or reorder she hasn't shown
  // before opens her panel at it; anything else new makes her badge bounce.
  // Reorders and waitlist openings already there when the calendar opens
  // just make her badge bounce; new ones while it's open open her panel.
  const seen = useRef(new Set<string>());
  const looked = useRef(false);
  // Someone using the side panel (a booking, the walk-ins, a visit's
  // details): Denise's badge calls rather than taking the panel over.
  const busyWith = useRef<Selection["kind"]>("none");
  useEffect(() => {
    busyWith.current = panelOpen ? selection.kind : "none";
  });
  const showDenise = useCallback((state: DeniseState, forData: BoardData) => {
    setDenise({ state, for: forData });
    const keys = deniseKeys(state);
    const fresh = keys.filter((k) => !seen.current.has(k));
    for (const k of keys) seen.current.add(k);
    const first = !looked.current;
    looked.current = true;
    if (fresh.length) setUnseen((all) => new Set([...all, ...fresh]));
    // Risks she expects (likely overruns) wait in her badge and brief: they
    // aren't urgent enough to take over the panel.
    const urgent = (k: string) => k.startsWith("conflict:") && !k.includes(":likely:");
    if (fresh.some((k) => urgent(k) || (!first && (k.startsWith("reorder:") || k.startsWith("opening:")))) && busyWith.current === "none") {
      setTab("denise");
      setPanelOpen(true);
    }
  }, []);

  // Denise looks again whenever the calendar changes.
  const scans = useRef(0);
  useEffect(() => {
    const id = ++scans.current;
    // Offline, she looks again when the calendar next changes.
    scanDenise(data.date).then(
      (state) => {
        if (state && id === scans.current) showDenise(state, data);
      },
      () => {},
    );
  }, [data, showDenise]);

  // Escape closes the panel (unless a menu or picker inside it is open).
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog], [role=listbox]")) return;
      leave(
        () => setPanelOpen(false),
        () => setSelection({ kind: "none" }),
      );
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, leave]);

  // ⌘K / Ctrl+K (or her bubble's shortcut from another page) opens her tab
  // with the cursor in her message box.
  useDeniseShortcut(focusDenise);
  const [focusSeen, setFocusSeen] = useState(deniseFocus);
  if (focusSeen !== deniseFocus) {
    setFocusSeen(deniseFocus);
    setTab("denise");
    setPanelOpen(true);
  }

  // Looking at Denise's panel clears what was new.
  if (panelOpen && tab === "denise" && unseen.size) setUnseen(new Set());

  const deniseState = denise && denise.state.date === data.date ? denise.state : null;
  const conflicts = (deniseState?.conflicts ?? []).filter((c) => !dismissed.has(c.subject));
  const notices = (deniseState?.notices ?? []).filter((n) => !dismissed.has(n.id));
  // How many things Denise wants looked at.
  const attention = conflicts.length + notices.length + (deniseState?.reorders.length ?? 0) + (deniseState?.openings.length ?? 0);
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

  // The visit open in booking details, so Denise knows whose it is.
  const openVisit = panelOpen && selection.kind === "detail" ? selection.appointmentId : null;
  async function ask(question: string) {
    if (deniseRun.working) return;
    setTab("denise");
    setPanelOpen(true);
    await askDenise(question, { date: data.date, page: { path: "/calendar", appointmentId: openVisit } });
  }

  // "Open in booking form" on one of her booking cards (here or on another
  // page): the booking form, filled in, on that day.
  useEffect(() => {
    if (!adjust || !me.canBook) return;
    if (adjust.date !== data.date) {
      router.push(adjust.date === data.today ? "/calendar" : `/calendar?date=${adjust.date}`);
      return;
    }
    const a = takeAdjust();
    if (!a?.lines.length) return;
    queueMicrotask(() =>
      leave(() => show({ kind: "book", start: { staffId: a.lines[0].staffId, startMinute: a.lines[0].startMinute }, draft: { date: a.date, lines: a.lines }, client: a.client ?? undefined })),
    );
    // show and leave are this render's; the form opens once per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust, data.date]);

  // Something that triggers Denise (a report, a cancellation): she shows
  // she's thinking at once, then always replies. Her panel opens, unless
  // someone is in the middle of a booking, when her badge calls instead.
  async function trigger(request: DeniseRequest, firstStatus: string) {
    const midTask = selection.kind === "book" || selection.kind === "edit" || selection.kind === "new-block" || selection.kind === "group";
    if (!midTask) {
      setTab("denise");
      setPanelOpen(true);
    }
    setOutcome(null);
    const done = await startDenise(request, firstStatus);
    if (done.state) {
      // Conflicts from this report are new, whatever was seen before.
      for (const k of [...seen.current]) if (k.startsWith("conflict:")) seen.current.delete(k);
      showDenise(done.state, data);
    }
    appendDenise({ role: "denise", text: done.reply.text });
    if (midTask) setUnseen((all) => new Set([...all, `reply:${all.size}:${done.reply.text}`]));
    router.refresh();
  }
  const firstNameOf = (staffId: string) => data.columns.find((c) => c.staffId === staffId)?.firstName ?? "the stylist";
  const markOut = (staffId: string) =>
    trigger({ action: "report_out", date: data.date, staffId }, `Looking at ${firstNameOf(staffId)}'s clients${data.date === data.today ? " for the rest of today" : ""}…`);
  const reportLate = (itemId: string, minutes: number) => trigger({ action: "report_late", date: data.date, itemId, minutes }, "Checking what that pushes into…");
  const onCanceled = (appointmentId: string) => trigger({ action: "canceled", date: data.date, appointmentId }, "Looking at the time that opened up…");
  // Following a link from the Dashboard (the panel and column are set up
  // above): scroll to the stylist's column, ask the question, and tidy the
  // address so a reload doesn't ask again. Once, on arrival.
  const followed = useRef(false);
  useEffect(() => {
    if (followed.current) return;
    followed.current = true;
    const { staffId, denise: openDenise, appointmentId, ask: question, book } = data.focus;
    if (!staffId && !openDenise && !appointmentId && !question && !book) return;
    if (staffId) columnRefs.current.get(staffId)?.scrollIntoView({ inline: "center", block: "nearest" });
    if (staffId) setTimeout(() => setFocusedStaff(null), 2500);
    if (question) queueMicrotask(() => ask(question));
    window.history.replaceState(null, "", data.date === data.today ? "/calendar" : `/calendar?date=${data.date}`);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // The fix shown on the calendar, only while her panel is open and showing
  // it: the one hovered there, or her first suggestion. Blocks it's about
  // glow; where they'd go shows dashed. Nothing is left on the calendar once
  // the panel closes, she moves on, or the fix is applied or dismissed.
  const showingFixes = panelOpen && tab === "denise" && !deciding;
  const previewConflict = showingFixes ? (preview && conflicts.find((c) => c.subject === preview.subject)) || conflicts[0] || null : null;
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
  const departments = FAMILIES.filter((f) => data.columns.some((c) => offersFamily(c, f)));
  const currentView = data.views.find((v) => viewKey(v.id) === view) ?? null;
  // The view's stylists, in its order (or the salon's), as just reordered.
  const ordered = (list: ColumnData[]) => (savedOrder ? [...list].sort((a, b) => savedOrder.indexOf(a.staffId) - savedOrder.indexOf(b.staffId)) : list);
  const inView = ordered(viewColumns(data.columns, view, data.views, offersFamily));

  const placed = (b: BlockData): BlockData => {
    const m = moves[b.itemId];
    if (!m) return b;
    const shift = m.start - b.start;
    return { ...b, staffId: m.staffId, start: b.start + shift, end: b.end + shift, segments: b.segments.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })) };
  };
  const blocks = data.blocks.map(placed);
  // Booking details with the same moves, so it never shows the old time
  // while a move is saving.
  const detailOf = (appointmentId: string): AppointmentDetail => {
    const a = data.appointments[appointmentId];
    if (!a.items.some((i) => moves[i.id])) return a;
    const items = a.items.map((i) => {
      const m = moves[i.id];
      if (!m) return i;
      const shift = m.start - i.start;
      return { ...i, staffId: m.staffId, staffName: data.columns.find((c) => c.staffId === m.staffId)?.name ?? i.staffName, start: i.start + shift, end: i.end + shift };
    });
    return { ...a, items };
  };
  // Who's off that day is hidden (unless asked for), except anyone with a
  // booking, a stylist a link asked for, or one Denise's fix would move a
  // client to.
  // Booked with a client, or at an event: on the calendar even on a day off.
  const off = offColumns(inView, new Set([...data.blocks.map((b) => b.staffId), ...data.timeBlocks.filter((b) => b.kind === "event").map((b) => b.staffId)]));
  const keep = new Set([data.focus.staffId, ...(previewOption?.moves ?? []).map((m) => m.to.staffId)]);
  const hidden = showOff ? new Set<string>() : new Set(off.filter((c) => !keep.has(c.staffId)).map((c) => c.staffId));
  const shownColumns = inView.filter((c) => !hidden.has(c.staffId));
  const columns = columnDrag ? moveItem(shownColumns, shownColumns.findIndex((c) => c.staffId === columnDrag.staffId), columnDrag.to) : shownColumns;
  // Fit all: in Compact, every column squeezes on screen, names shortened.
  const squeezed = fitAll && zoom === "compact";
  const canMove = (b: BlockData) => me.canBook && isEditable(b.status);
  const selectedAppointment = selection.kind === "detail" || selection.kind === "edit" ? selection.appointmentId : null;
  const selectedGroup = selectedAppointment ? (data.appointments[selectedAppointment]?.group?.id ?? null) : null;

  // Who can drag a column header: owners, for the salon's order (on
  // everyone or a department); anyone, for a view of their own (owners,
  // shared views too).
  const canReorder = currentView ? currentView.editable : me.canArrange;
  const headerRefs = useRef(new Map<string, HTMLElement>());

  // Scrolls the grid sideways while something is dragged near its edge.
  function edgeScroll(clientX: number) {
    const el = gridRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = r.left + 64;
    if (clientX > r.right - EDGE_ZONE) el.scrollLeft += Math.ceil((EDGE_STEP * (clientX - (r.right - EDGE_ZONE))) / EDGE_ZONE);
    else if (clientX < left + EDGE_ZONE) el.scrollLeft -= Math.ceil((EDGE_STEP * (left + EDGE_ZONE - clientX)) / EDGE_ZONE);
  }

  // Dragging a header by its grip: the columns make room as it goes, and
  // the new order saves on letting go (followed on the window, since the
  // header moves in the page). However it ends (dropped, Escape, the
  // browser taking the pointer, the window losing focus) the drag is
  // cleared, so every header is back as it was.
  function onHeaderGrip(e: React.PointerEvent, staffId: string) {
    if (e.button !== 0 || columnDrag) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    const before = shownColumns.map((c) => c.staffId);
    let to = before.indexOf(staffId);
    setColumnDrag({ staffId, to });
    const finish = (save: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
      setColumnDrag(null);
      const after = moveItem(before, before.indexOf(staffId), to);
      if (save && after.some((id, i) => id !== before[i])) saveOrder(before, after);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      edgeScroll(ev.clientX);
      to = before.filter((id) => id !== staffId).filter((id) => {
        const r = headerRefs.current.get(id)?.getBoundingClientRect();
        return r && ev.clientX > r.left + r.width / 2;
      }).length;
      setColumnDrag({ staffId, to });
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(ev.type === "pointerup");
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    const onBlur = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
  }

  // Saves a new order for the columns shown: the view's own, or the
  // salon's (the others shown elsewhere keep their places).
  function saveOrder(before: string[], after: string[]) {
    setNotice(null);
    const all = currentView ? currentView.staffIds : data.columns.map((c) => c.staffId);
    const next = mergeOrder(all, before, after);
    startTransition(async () => {
      setSavedOrder(next);
      const result = currentView
        ? await saveCalendarView({ id: currentView.id, name: currentView.name, staffIds: next, shared: currentView.shared })
        : await setCalendarOrder(next);
      if (!result.ok) setNotice(`Couldn't save the new order: ${"message" in result ? result.message : ""}`);
    });
  }

  function columnAt(clientX: number): string | null {
    for (const [staffId, el] of columnRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return staffId;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent, b: BlockData) {
    if (e.button !== 0 || !canMove(b)) return;
    const el = e.currentTarget as HTMLElement;
    const origin = el.offsetParent as HTMLElement | null;
    dragOrigin.current = origin;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const drag: Drag = {
      itemId: b.itemId,
      staffId: b.staffId,
      start: b.start,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      // From where it's placed, not where it's drawn (it lifts on hover).
      grab: e.clientY - ((origin?.getBoundingClientRect().top ?? 0) + el.offsetTop),
      fromStaffId: b.staffId,
      fromStart: b.start,
      length: b.end - b.start,
      moved: false,
    };
    if (e.pointerType === "touch") {
      // Held still: picked up where it is.
      const target = e.currentTarget;
      return startPress(e, () => {
        if (target.isConnected) target.setPointerCapture(drag.pointerId);
        dragRef.current = { ...drag, moved: true };
        setHint(null);
        setDrag(dragRef.current);
      });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = drag;
  }

  function onPointerMove(e: React.PointerEvent) {
    const touch = pressState(e);
    if (touch === "wait" || touch === "swipe") return;
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    edgeScroll(e.clientX);
    lastPointer.current = { x: e.clientX, y: e.clientY };
    dragTo(d);
  }

  // Puts the dragged block where the pointer holds it: its top the grab
  // below the pointer, on the nearest 15-minute line of the column under it.
  function dragTo(d: Drag) {
    const origin = dragOrigin.current;
    if (!origin) return;
    const { x, y: pointerY } = lastPointer.current;
    const minute = range.start + (pointerY - d.grab - origin.getBoundingClientRect().top) / PX_PER_MINUTE;
    const start = Math.min(Math.max(Math.round(minute / SLOT_STEP) * SLOT_STEP, range.start), range.end - d.length);
    const next = { ...d, moved: true, start, staffId: columnAt(x) ?? d.staffId };
    dragRef.current = next;
    setDrag(next);
  }

  function onPointerUp(e: React.PointerEvent, b: BlockData) {
    endPress();
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
    if (panelOpen) return leave(() => setPanelOpen(false), closeDetails);
    const top = e.currentTarget.getBoundingClientRect().top;
    const minute = range.start + Math.floor((e.clientY - top) / PX_PER_MINUTE / SLOT_STEP) * SLOT_STEP;
    const start = { staffId: column.staffId, startMinute: Math.min(minute, range.end - SLOT_STEP) };
    if (me.canBook) select({ kind: "book", start });
    else if (column.staffId === me.staffId) select({ kind: "new-block", start });
  }

  // Whose time this person can block: anyone's for the front of house,
  // their own for stylists.
  const blockStaff = me.canBook ? data.columns.map((c) => c.staffId) : data.columns.some((c) => c.staffId === me.staffId) ? [me.staffId] : [];
  // Event holds change only with their event.
  const canEditBlock = (b: TimeBlockData) => b.kind !== "event" && blockStaff.includes(b.staffId);
  const timeBlocks = data.timeBlocks.map((b) => ({ ...b, ...blockMoves[`${b.blockId}:${b.start}`] }));

  function onBlockPointerDown(e: React.PointerEvent, b: TimeBlockData, mode: "move" | "resize") {
    if (e.button !== 0 || !canEditBlock(b)) return;
    e.stopPropagation();
    const drag: BlockDrag = { key: `${b.blockId}:${data.timeBlocks.find((x) => x.blockId === b.blockId)!.start}`, block: b, mode, pointerId: e.pointerId, y: e.clientY, start: b.start, end: b.end, moved: false };
    if (e.pointerType === "touch") {
      const target = e.currentTarget;
      return startPress(e, () => {
        if (target.isConnected) target.setPointerCapture(drag.pointerId);
        setBlockDrag({ ...drag, moved: true });
      });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setBlockDrag(drag);
  }

  function onBlockPointerMove(e: React.PointerEvent) {
    const touch = pressState(e);
    if (touch === "wait" || touch === "swipe") return;
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
    // A touch that was never held opens it with its click (onOpen).
    endPress();
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
    gridTemplateColumns: `4rem repeat(${columns.length}, minmax(${squeezed ? "0px" : COLUMN_MIN}, 1fr))`,
  };
  const dayLink = (d: string) => (d === data.today ? "/calendar" : `/calendar?date=${d}`);
  const closeDetails = () => setSelection({ kind: "none" });
  const goTo = (d: string) => leave(() => router.push(dayLink(d), { transitionTypes: [d > data.date ? "nav-forward" : "nav-back"] }), closeDetails);
  // A form's own Cancel.
  const cancel = () => leave(closeDetails);
  // A visit moved to another day: go there, with it open.
  const openOn = (d: string, appointmentId: string) => {
    setArriving(appointmentId);
    router.push(dayLink(d), { transitionTypes: [d > data.date ? "nav-forward" : "nav-back"] });
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* With the panel open on a wide screen, the page makes room for it, so
          the toolbar wraps instead of hiding under it. */}
      <div
        className={`flex min-w-0 flex-1 flex-col gap-4 px-4 pt-6 pb-4 transition-[padding] duration-(--motion-slow) sm:px-6 lg:min-h-0 ${panelOpen ? "lg:pr-[25.5rem]" : ""}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Appointments</h1>
            <ViewTransition key={data.date} enter={DAY_SLIDE} exit="none" default="none">
              <p className="mt-1 text-base text-ink-muted" data-testid="calendar-date">
                {formatLongDay(data.date)}
                <span className="ml-2 text-sm">
                  {data.date === data.today ? "Today · " : ""}
                  {data.openLabel}
                </span>
              </p>
            </ViewTransition>
          </div>
          {/* New booking and New sale stay in view; the rest are under More. */}
          <div className="flex min-w-0 flex-wrap gap-2">
            <MoreMenu
              items={[
                { label: "Waitlist", href: "/calendar/waitlist" },
                ...(me.canBook ? [{ label: "Walk-ins", onSelect: () => select({ kind: "walk-ins" }) }] : []),
                ...(blockStaff.length > 0
                  ? [{ label: "Block time", onSelect: () => select({ kind: "new-block", start: { staffId: blockStaff.includes(me.staffId) ? me.staffId : blockStaff[0], startMinute: 12 * 60 } }) }]
                  : []),
              ]}
            />
            {me.canBook && <NewSaleLink size="lg" />}
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
              // On today: in the active blue, so it's clear where you are.
              className={buttonClass("secondary", "md", data.date === data.today ? "border-active/40! bg-active-soft! text-active-ink!" : "")}
            >
              Today
            </Link>
            <DatePicker value={data.date} today={data.today} onChange={goTo} label="Go to date" />
          </nav>
          <Listbox
            label="Department or view"
            value={currentView || !view.startsWith("view:") ? view : "all"}
            onChange={(next: string) => {
              if (next === "action:new") setEditing({ viewId: null });
              else if (next === "action:edit") setEditing({ viewId: currentView!.id });
              else setView(next as ViewKey);
            }}
            className="w-48 xl:w-56"
            options={[
              { value: "all", label: "All departments" },
              ...departments.map((f) => ({
                value: f,
                label: FAMILY_LABELS[f],
                group: "Departments",
                icon: (
                  <span data-family={f} aria-hidden className="h-3 w-3 shrink-0 rounded-[3px] border-l-[3px] border-(--fam-accent) bg-(--fam-fill)" />
                ),
              })),
              ...data.views.filter((v) => v.shared).map((v) => ({ value: viewKey(v.id), label: v.name, group: "Views for everyone" })),
              ...data.views.filter((v) => !v.shared).map((v) => ({ value: viewKey(v.id), label: v.name, group: "My views" })),
              ...(currentView?.editable ? [{ value: "action:edit", label: `Edit ${currentView.name}…`, group: "Views", action: true }] : []),
              { value: "action:new", label: "New view…", group: "Views", action: true, icon: <PlusIcon className="size-4 text-ink-muted" /> },
            ]}
          />
          {off.length > 0 && <OffChip off={off} shown={showOff} onShow={setShowOff} isToday={data.date === data.today} />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ViewMenu zoom={zoom} onZoom={setZoom} fitAll={fitAll} onFitAll={setFitAll} />
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
          <div
            ref={gridRef}
            // The day scrolling under a dragged block moves it with the grid.
            onScroll={() => dragRef.current?.moved && dragTo(dragRef.current)}
            // Sideways swipes scroll the stylists, never the browser back a page.
            className="overflow-auto overscroll-x-contain rounded-lg border border-line bg-surface lg:min-h-0 lg:flex-1"
            data-testid="calendar-grid"
            data-zoom={zoom}
            data-px-per-minute={PX_PER_MINUTE}
            data-fit-all={squeezed || undefined}
          >
            <ScaleContext value={PX_PER_MINUTE}>
            {columns.length === 0 ? (
              off.length > 0 ? (
                <div className="flex flex-col items-start gap-3 p-6">
                  <p className="text-ink-muted">{data.openLabel === "Salon closed" ? "The salon is closed" : "No one here is working"}{data.date === data.today ? " today" : " this day"}.</p>
                  <Button onClick={() => setShowOff(true)}>Show them anyway</Button>
                </div>
              ) : (
                <p className="p-6 text-ink-muted">No one in this department works here. Choose another department.</p>
              )
            ) : (
              // Columns share the width; below their minimum the grid scrolls.
              <div className="min-w-fit">
                {/* Above everything on the grid (a dragged visit or blocked
                    time, Denise's previews: z-40 at most), so a stylist's name
                    and avatar are never covered; below menus and popovers. */}
                <div data-grid-header className="sticky top-0 z-[45] grid border-b border-line-strong bg-surface" style={gridColumns}>
                  <div className="sticky left-0 z-10 bg-surface" />
                  {columns.map((c) => (
                      <div
                        key={c.staffId}
                        ref={(el) => {
                          if (el) headerRefs.current.set(c.staffId, el);
                          else headerRefs.current.delete(c.staffId);
                        }}
                        className={`relative flex min-w-0 flex-col gap-1 border-l border-line py-2.5 ${squeezed ? "px-1.5" : "px-2.5"} ${columnDrag?.staffId === c.staffId ? "z-10 bg-navy-100 shadow-lift" : ""}`}
                        data-column-header
                        data-dragging={columnDrag?.staffId === c.staffId || undefined}
                        data-level={c.level ?? undefined}
                      >
                        {c.level && <span aria-hidden data-testid="level-bar" className={`absolute inset-x-0 top-0 h-1 ${LEVEL_BG[c.level]}`} />}
                        {canReorder && !squeezed && (
                          <span
                            aria-hidden
                            data-column-grip
                            title="Drag to change the order"
                            onPointerDown={(e) => onHeaderGrip(e, c.staffId)}
                            className="absolute top-1 left-1/2 flex h-4 w-8 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded text-ink-subtle opacity-60 hover:bg-sunken hover:opacity-100 active:cursor-grabbing"
                          >
                            <GripIcon className="size-3.5 rotate-90" />
                          </span>
                        )}
                        <div className="flex min-w-0 items-center gap-2">
                          {/* Squeezed (Fit all), the avatar goes so the name fits. */}
                          {!squeezed && <Avatar name={c.name} color={c.color} level={c.level} size="sm" />}
                          <div className="min-w-0 flex-1">
                            <span title={squeezed ? `${c.name} · ${c.booked}` : c.name} className="block">
                              <FitText variants={nameVariants(c.name, c.firstName, squeezed)} className="text-sm font-semibold" />
                            </span>
                            {/* One line, the full hours on hover. */}
                            <div title={c.hoursLabel} data-testid="column-hours" className="truncate text-xs leading-4 whitespace-nowrap text-ink-muted">
                              {c.working ? c.hoursShort : c.offReason}
                            </div>
                          </div>
                        </div>
                        {/* Their day at a glance, across the column: shortened to
                            fit, never cut off, with the full text on hover. */}
                        {!squeezed && (
                          <div title={c.booked} className={`text-13 text-ink-muted ${c.working && data.date >= data.today && (me.canBook || me.staffId === c.staffId) ? "pr-7" : ""}`} data-testid="booked-summary">
                            <FitText variants={summaryVariants(c.booked)} />
                          </div>
                        )}
                        {!squeezed && c.working && data.date >= data.today && (me.canBook || me.staffId === c.staffId) && (
                          <div className="absolute right-1 bottom-1">
                            <OutMenu column={c} date={data.date} today={data.today} onMarkOut={markOut} canRescue={me.canBook} />
                          </div>
                        )}
                      </div>
                  ))}
                </div>

                <div className="relative grid" style={gridColumns} data-range-start={range.start}>
                  <div className="sticky left-0 z-20 bg-surface" style={{ height }} aria-hidden>
                    {/* Every quarter hour: hours bold ("10am"), quarters small and
                        light (":15"). The current-time pill takes a label's
                        place when they'd overlap. */}
                    {quarterMarks(range).map(({ minute: m, hour }) => (
                      <span
                        key={m}
                        {...(hour ? { "data-hour-label": m } : { "data-quarter-label": m })}
                        aria-hidden={nowHides(m) || undefined}
                        className={`absolute right-2 transition-opacity duration-(--motion-fast) ${hour ? "text-xs font-semibold text-ink" : "text-[11px] text-ink-subtle"} ${m === range.start ? "translate-y-1" : "-translate-y-1/2"} ${nowHides(m) ? "opacity-0" : ""}`}
                        style={{ top: y(m) }}
                      >
                        {hour ? formatMinute(m) : `:${String(m % 60).padStart(2, "0")}`}
                      </span>
                    ))}
                  </div>

                  {columns.map((c) => (
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
                          (drag?.moved && drag.staffId === c.staffId) || focusedStaff === c.staffId ? "bg-navy-100/40" : ""
                        }`}
                        style={{
                          height,
                          // Hour lines darker, quarter-hour lines faint.
                          backgroundImage: `linear-gradient(to bottom, var(--color-line-strong) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--color-line) 60%, transparent) 1px, transparent 1px)`,
                          backgroundSize: `100% ${60 * PX_PER_MINUTE}px, 100% ${15 * PX_PER_MINUTE}px`,
                        }}
                      >
                        {c.offHours.map((o) => (
                          <div
                            key={o.start}
                            data-off-hours
                            aria-hidden
                            title="Not bookable"
                            className="absolute inset-x-0 bg-off-hours/75"
                            style={{ top: y(o.start), height: (o.end - o.start) * PX_PER_MINUTE }}
                          />
                        ))}

                        {c.timeOff.map((t) => (
                          <div
                            key={`${t.start}-${t.label}`}
                            data-time-off
                            className="absolute inset-x-1 z-0 truncate rounded-md border border-line-strong bg-sunken px-2 py-1 text-xs font-medium text-ink-muted"
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
                            if (b.kind === "event") return <EventHoldBox key={`${b.blockId}:${b.start}`} block={b} y={y} columnName={c.name} />;
                            return (
                              <TimeBlockBox
                                key={`${b.blockId}:${b.start}`}
                                block={live}
                                y={y}
                                editable={canEditBlock(b)}
                                dragging={blockDrag?.block.blockId === b.blockId && blockDrag.moved}
                                selected={selection.kind === "block" && selection.blockId === b.blockId}
                                columnName={c.name}
                                labelOnTop={!blocks.some((a) => a.staffId === c.staffId && a.start < live.start + 30 && a.end > live.start)}
                                onPointerDown={onBlockPointerDown}
                                onPointerMove={onBlockPointerMove}
                                onPointerUp={onBlockPointerUp}
                                onPointerCancel={() => {
                                  endPress();
                                  setBlockDrag(null);
                                }}
                                onOpen={() => select({ kind: "block", blockId: b.blockId })}
                              />
                            );
                          })}

                        {drag?.moved && drag.staffId === c.staffId && <DragGhost block={blocks.find((b) => b.itemId === drag.itemId)!} start={drag.start} stylist={c.firstName} y={y} />}


                        <ul aria-label={`${c.name}'s appointments`}>
                          {layoutColumn<Placed>([...blocks.filter((b) => b.staffId === c.staffId), ...fixGhosts(c.staffId)]).map((b) =>
                            b.ghost ? (
                              <FixGhost key={b.itemId} block={b} y={y} />
                            ) : (
                            <AppointmentBlock
                              key={b.itemId}
                              block={b}
                              y={y}
                              lateBy={nowMinute !== null && (b.status === "booked" || b.status === "confirmed") && b.start <= nowMinute ? nowMinute - b.start : null}
                              draggable={canMove(b)}
                              dragging={drag?.moved === true && drag.itemId === b.itemId}
                              selected={b.appointmentId === selectedAppointment}
                              highlight={highlighted.has(b.itemId)}
                              grouped={!!selectedGroup && b.group?.id === selectedGroup && b.appointmentId !== selectedAppointment}
                              stylist={data.columns.find((c) => c.staffId === b.staffId)?.name ?? ""}
                              onHint={(details, rect) => setHint(details && !dragRef.current ? { id: b.itemId, details, rect } : null)}
                              settling={settling === b.itemId}
                              squeezed={squeezed}
                              onSettled={() => setSettling(null)}
                              onPointerDown={(e) => {
                                setHint(null);
                                onPointerDown(e, b);
                              }}
                              onPointerMove={onPointerMove}
                              onPointerUp={(e) => onPointerUp(e, b)}
                              onPointerCancel={() => {
                                endPress();
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
                  ))}

                  <div className="pointer-events-none absolute inset-y-0 right-0 left-16">
                    <NowLine date={data.date} timeZone={data.timeZone} startMinute={range.start} endMinute={range.end} pxPerMinute={PX_PER_MINUTE} />
                  </div>
                </div>
              </div>
            )}
            </ScaleContext>
          </div>
        </ViewTransition>

        {/* The key, with Denise's face at the end of the row while her panel
            is closed (so she never sits on top of the calendar). */}
        <div className="flex items-center gap-4">
          <CalendarKey families={FAMILIES.filter((f) => f !== "other" && data.menu.services.some((s) => s.family === f && !s.archived))} />
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

      {editing && (
        <ViewEditor
          view={editing.viewId ? (data.views.find((v) => v.id === editing.viewId) ?? null) : null}
          // A new view starts from the department or view on screen.
          start={view === "all" ? [] : inView.map((c) => c.staffId)}
          team={data.columns}
          departments={departments.map((f): Department => ({ label: FAMILY_LABELS[f], staffIds: data.columns.filter((c) => offersFamily(c, f)).map((c) => c.staffId) }))}
          views={data.views}
          canShare={me.canArrange}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setView(viewKey(id));
          }}
          onDeleted={() => {
            setEditing(null);
            setView("all");
          }}
        />
      )}

      {undoable && (
        <div
          role="status"
          data-testid={undoable.kind === "check_in" ? "check-in-toast" : "no-show-toast"}
          className={toastClass}
        >
          <span>{undoable.kind === "check_in" ? `${undoable.name} is checked in.` : `${undoable.name} is marked a no-show.`}</span>
          <button
            type="button"
            className={toastActionClass}
            onClick={() => {
              const { kind, appointmentId } = undoable;
              setUndoable(null);
              startTransition(async () => {
                const result = kind === "check_in" ? await undoVisitCheckIn(appointmentId) : await undoVisitNoShow(appointmentId);
                if (!result.ok) setNotice(result.message);
              });
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Denise and booking details: a panel that slides over the calendar
          when something opens it. */}
      <guard.Provider value={guard.set}>
        <aside
          aria-label="Assistant and booking details"
          className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-4 border-l border-line bg-surface p-4 shadow-panel transition-[transform,visibility] duration-(--motion-slow) ease-out sm:w-96 ${
            // Closed, it's hidden once it has slid away, so keyboard focus skips it.
            panelOpen ? "visible translate-x-0" : "invisible translate-x-full"
          }`}
        >
          <Tabs
            label="Assistant"
            value={tab}
            onChange={setTab}
            panelKey={`${tab}-${selection.kind}-${"appointmentId" in selection ? selection.appointmentId : ""}`}
            tabs={[
              { value: "denise", label: "Denise", icon: <DeniseFace size={20} />, badge: <DeniseBadge count={attention} /> },
              { value: "details", label: "Booking details", icon: <CalendarIcon className="size-4" /> },
            ]}
            trailing={
              // The panel's one close button (a visit being viewed is let go too).
              <IconButton
                label="Close panel"
                onClick={() =>
                  leave(() => {
                    setPanelOpen(false);
                    if (selection.kind === "detail") closeDetails();
                  }, closeDetails)
                }
              >
                <CloseIcon />
              </IconButton>
            }
          >
            {tab === "denise" ? (
              <DenisePanel
                data={data}
                state={deniseState && { ...deniseState, conflicts, notices }}
                working={deciding || deniseRun.working || (scanning && !deniseState)}
                run={deniseRun}
                outcome={outcome}
                preview={preview}
                onApprove={approve}
                onReject={reject}
                onUndo={undo}
                onDismiss={(subject) => setDismissed((all) => new Set(all).add(subject))}
                onPreview={setPreview}
                onOpen={(appointmentId) => select({ kind: "detail", appointmentId })}
                onDismissNotice={(id) => {
                  setDismissed((all) => new Set(all).add(id));
                  startTransition(() => dismissDeniseItem(id, data.date).then(() => {}));
                }}
                onNoShow={(n) => {
                  setDismissed((all) => new Set(all).add(n.id));
                  startTransition(async () => {
                    const result = await changeVisitStatus(n.appointmentId, "no_show");
                    if (result.ok) offerUndo("no_show", n.appointmentId, n.clientName.split(" ")[0]);
                    else setOutcome({ message: result.message ?? "That didn't work. Try again from the booking.", error: true, undoActionId: null });
                    if (!result.ok)
                      setDismissed((all) => {
                        const next = new Set(all);
                        next.delete(n.id);
                        return next;
                      });
                  });
                }}
                onBookWaitlist={(o, m) => decide(() => bookFromWaitlist(m.entryId, o.staffId, data.date, m.startMinute), null)}
              >
                <DeniseChat
                  canBook={me.canBook}
                  today={data.today}
                  date={data.date}
                  appointmentId={openVisit}
                  placeholder={me.canBook ? askExample(data) : undefined}
                  onBooked={(appointmentId, date) => {
                    router.refresh();
                    if (date !== data.date) openOn(date, appointmentId);
                  }}
                />
              </DenisePanel>
            ) : selection.kind === "detail" && data.appointments[selection.appointmentId] ? (
              <AppointmentPanel
                date={data.date}
                today={data.today}
                timeZone={data.timeZone}
                appointment={detailOf(selection.appointmentId)}
                me={me}
                onEdit={() => select({ kind: "edit", appointmentId: selection.appointmentId })}
                onClose={closeDetails}
                onReportLate={reportLate}
                onCanceled={onCanceled}
                // A full load: /checkout/new is a route handler that opens the checkout.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                onCheckout={() => window.location.assign(`/checkout/new?appointment=${selection.appointmentId}&from=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
                onOpenVisit={(appointmentId) => select({ kind: "detail", appointmentId })}
                onCheckedIn={(appointmentId) => offerUndo("check_in", appointmentId)}
                onNoShow={(appointmentId) => offerUndo("no_show", appointmentId)}
                onMoved={(date, appointmentId, message) => {
                  if (date !== data.date) openOn(date, appointmentId);
                  setDoneMessage(message);
                }}
                team={data.columns.map((c) => ({ id: c.staffId, name: c.name }))}
                products={data.menu.products}
              />
            ) : selection.kind === "walk-ins" ? (
              <WalkInPanel
                data={data}
                onClose={cancel}
                onBooked={(id, message) => {
                  setDoneMessage(message);
                  if (data.date === data.today) show({ kind: "detail", appointmentId: id });
                  else closeDetails();
                }}
              />
            ) : selection.kind === "book" ? (
              <BookingPanel
                key={selection.draft ? JSON.stringify(selection.draft) : "new"}
                data={data}
                start={selection.start}
                client={selection.client}
                draft={selection.draft}
                onClose={cancel}
                onSaved={(id, message, date) => {
                  if (date && date !== data.date) openOn(date, id);
                  else show({ kind: "detail", appointmentId: id });
                  if (message) setDoneMessage(message);
                }}
                onBlockInstead={blockStaff.includes(selection.start.staffId) ? () => show({ kind: "new-block", start: selection.start }) : undefined}
                onGroupInstead={() => show({ kind: "group", start: selection.start })}
              />
            ) : selection.kind === "group" ? (
              <GroupPanel
                data={data}
                start={selection.start}
                onClose={cancel}
                onSaved={(id, message) => {
                  show({ kind: "detail", appointmentId: id });
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
                onClose={cancel}
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
                appointment={detailOf(selection.appointmentId)}
                onClose={() => select({ kind: "detail", appointmentId: selection.appointmentId })}
                onSaved={(id, message, date) => {
                  if (date && date !== data.date) openOn(date, id);
                  else show({ kind: "detail", appointmentId: selection.appointmentId });
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
      </guard.Provider>

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
      {guard.dialog}
    </div>
  );
}

// Everything Denise is showing, as stable keys, for spotting what's new.
// The sticky stylist header at the top of the scrolling grid.
const headerHeight = (grid: HTMLElement) => (grid.querySelector("[data-grid-header]") as HTMLElement | null)?.offsetHeight ?? 0;

// The calendar's display options in one menu, to keep the toolbar simple:
// the zoom (Compact, Comfortable, Detailed) and, in Compact, Fit all.
function ViewMenu({ zoom, onZoom, fitAll, onFitAll }: { zoom: CalendarZoom; onZoom: (z: CalendarZoom) => void; fitAll: boolean; onFitAll: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useKeepOnScreen(pop, open);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="dialog" aria-label={ZOOM_LABELS[zoom]} title="Calendar display" onClick={() => setOpen(!open)} className={buttonClass("secondary", "md")}>
        <SlidersIcon className="size-4" />
        {/* Its name where there's room; the icon alone on an iPad, so the
            toolbar stays on one row (the name is still its label). */}
        <span className="hidden xl:inline">{ZOOM_LABELS[zoom]}</span>
        <ChevronDownIcon className="size-4 text-ink-muted" />
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label="Calendar display" className="absolute top-full right-0 z-50 mt-1.5 flex w-72 animate-pop-in flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-lift">
          <div className="flex flex-col gap-1.5">
            <span className="text-13 font-medium text-ink-muted">Zoom</span>
            <Segmented label="Zoom" value={zoom} onChange={onZoom} options={ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))} />
          </div>
          {zoom === "compact" && (
            <button type="button" aria-pressed={fitAll} title="Squeeze every stylist on screen" onClick={() => onFitAll(!fitAll)} className={buttonClass(fitAll ? "primary" : "secondary", "md", "w-full")}>
              Fit all
            </button>
          )}
          <p className="text-xs text-ink-muted">Pinch the calendar, or ctrl + scroll, to zoom too.</p>
        </div>
      )}
    </div>
  );
}

// Pinching the grid (or ctrl + scroll, a trackpad pinch) steps the zoom:
// far enough apart for the next level, together for the one before.
function usePinchZoom(grid: React.RefObject<HTMLDivElement | null>, zoom: CalendarZoom, setZoom: (z: CalendarZoom) => void) {
  const latest = useRef({ zoom, setZoom });
  useEffect(() => {
    latest.current = { zoom, setZoom };
  });
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const step = (by: 1 | -1) => {
      const { zoom: z, setZoom: set } = latest.current;
      const next = ZOOMS[ZOOMS.indexOf(z) + by];
      if (next) set(next);
    };
    let start: number | null = null;
    const apart = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = apart(e.touches);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || start === null) return;
      // Our zoom, not the browser's.
      e.preventDefault();
      const ratio = apart(e.touches) / start;
      if (ratio > PINCH_STEP || ratio < 1 / PINCH_STEP) {
        step(ratio > 1 ? 1 : -1);
        start = apart(e.touches);
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    let wheel = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      wheel += e.deltaY;
      if (Math.abs(wheel) > WHEEL_STEP) {
        step(wheel < 0 ? 1 : -1);
        wheel = 0;
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [grid]);
}

function deniseKeys(state: DeniseState): string[] {
  return [
    ...state.conflicts.map((c) => `conflict:${c.subject}`),
    ...state.notices.map((n) => `notice:${n.id}`),
    ...state.reorders.map((r) => `reorder:${r.supplierId}:${r.headline}`),
    ...state.openings.map((o) => `opening:${o.key}:${o.matches.length}`),
  ];
}

// An example for Denise's message box, naming someone on the team who does
// cuts (working today if possible): "Find a haircut with Gil after 1 PM".
function askExample({ columns, menu }: BoardData): string {
  const cuts = new Set(menu.services.filter((s) => s.family === "cut" && !s.archived).map((s) => s.id));
  const cutsHair = (c: ColumnData) => Object.keys(menu.offers[c.staffId] ?? {}).some((id) => cuts.has(id));
  const who = columns.find((c) => c.working && cutsHair(c)) ?? columns.find(cutsHair);
  return who ? `Find a haircut with ${who.firstName} after 1 PM` : "Who's free for a haircut after 1 PM?";
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
        className="flex w-full max-w-sm animate-pop-in flex-col gap-3 rounded-lg border border-line bg-surface p-5 shadow-lift"
      >
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
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
      className="relative ml-auto flex size-11 shrink-0 animate-pop-in items-center justify-center rounded-full bg-surface ring-1 ring-denise-200 transition-transform duration-(--motion-fast) hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-95"
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
const MENU_WIDTH = 340;
const MENU_MARGIN = 8;

function OutMenu({ column, date, today, onMarkOut, canRescue }: { column: ColumnData; date: string; today: string; onMarkOut: (staffId: string) => void; canRescue: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  // Where the popover sits: just below the stylist's header (never over
  // their name), right-aligned to it, kept inside the screen.
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const restOfDay = date === today;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node) && !popover.current?.contains(e.target as Node)) setOpen(false);
    };
    const position = () => {
      const header = root.current?.closest("[data-column-header]")?.getBoundingClientRect();
      if (!header) return;
      const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * MENU_MARGIN);
      const left = Math.min(Math.max(header.right - width, MENU_MARGIN), window.innerWidth - width - MENU_MARGIN);
      setPlace({ top: header.bottom + 6, left });
    };
    position();
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  // Denise takes it from here, in her panel (and says if it didn't work).
  function markOut() {
    setOpen(false);
    onMarkOut(column.staffId);
  }

  return (
    <div ref={root} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <IconButton label={`More for ${column.name}`} size="xs" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MoreIcon className="size-4" />
      </IconButton>
      {open &&
        place &&
        // On the page itself: the calendar grid would clip it.
        createPortal(
          <div
            ref={popover}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            role="dialog"
            aria-label={`${column.firstName}'s day`}
            className="fixed z-[60] flex origin-top-right animate-pop-in flex-col gap-3 rounded-lg border border-line bg-surface p-4 text-sm shadow-lift"
            style={{ top: place.top, left: place.left, width: `min(${MENU_WIDTH}px, calc(100vw - ${2 * MENU_MARGIN}px))` }}
          >
            <p className="text-ink">
              {canRescue
                ? `${column.firstName} is out? Plan the rescue to see where every client goes and apply it all at once, or mark them out and Denise suggests fixes one at a time.`
                : `Mark ${column.firstName} out ${restOfDay ? "for the rest of the day" : "for the day"}? Denise will find new places for ${column.firstName}'s clients.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {canRescue && (
                <a href={`/calendar/rescue?staff=${column.staffId}&date=${date}`} className={buttonClass("primary", "sm", "whitespace-nowrap")}>
                  Plan the rescue
                </a>
              )}
              <Button variant={canRescue ? "secondary" : "primary"} size="sm" onClick={markOut} className="whitespace-nowrap">
                {restOfDay ? "Out for the rest of the day" : "Out for the day"}
              </Button>
              <Button size="sm" onClick={() => setOpen(false)} className="whitespace-nowrap">
                Cancel
              </Button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// Where Denise's fix would put a block: a dashed periwinkle outline in its
// own lane.
function FixGhost({ block, y }: { block: Placed & { lane: number; lanes: number }; y: (minute: number) => number }) {
  const PX_PER_MINUTE = usePpm();
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

// A small "Key" button under the calendar, opening what the colors,
// statuses and level badges mean.
function CalendarKey({ families }: { families: ServiceFamily[] }) {
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
  const swatch = "h-3.5 w-5 shrink-0 rounded-[3px]";

  return (
    <div ref={root} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <Button size="sm" variant="ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        Key
        <ChevronDownIcon className={`size-4 ${open ? "" : "rotate-180"}`} />
      </Button>
      {open && (
        <div
          ref={pop}
          role="dialog"
          aria-label="Calendar key"
          className="absolute bottom-full left-0 z-[60] mb-2 grid w-[min(36rem,calc(100vw-2rem))] origin-bottom-left animate-pop-in gap-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted shadow-lift sm:grid-cols-3"
        >
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-ink">Services</h3>
            <ul aria-label="Service families" className="flex flex-col gap-1.5">
              {families.map((f) => (
                <li key={f} className="flex items-center gap-2" data-family={f}>
                  <span aria-hidden className={`${swatch} border-l-[3px] border-(--fam-accent) bg-(--fam-fill)`} />
                  {FAMILY_LABELS[f]}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`${swatch} border border-line-strong`}
                  style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, rgb(23 39 59 / 0.18) 3px 6px)" }}
                />
                Processing (stylist free)
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className={`${swatch} bg-off-hours ring-1 ring-line-strong`} />
                Not bookable
              </li>
            </ul>
          </section>
          {/* Where the client is in their visit: the block's fill (the
              service color until they're here). */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-ink">Visit status</h3>
            <ul aria-label="Visit status" className="flex flex-col gap-1.5" data-testid="status-legend">
              {(
                [
                  ["here", "Checked in"],
                  ["done", "Checked out"],
                  ["off", "No-show"],
                ] as const
              ).map(([visit, text]) => (
                // Checked out is shown on a service's own color, faded, with its check.
                <li key={visit} className="flex items-center gap-2" data-visit={visit} data-family={visit === "done" ? (families[0] ?? "cut") : undefined}>
                  <span aria-hidden className={`${swatch} flex items-center justify-end border-l-[3px] bg-(--visit-fill) ${visit === "done" ? "border-(--fam-accent) text-(--visit-ink-muted)" : "border-ink-subtle"}`}>
                    {visit === "done" && <CheckIcon className="size-3" />}
                  </span>
                  <span className={visit === "off" ? "line-through" : ""}>{text}</span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                <ClockIcon className="size-4 shrink-0 text-block-attention" />
                Running late, or not arrived
              </li>
            </ul>
          </section>
          {/* Stylist levels: the ring around each avatar and the bar on top
              of their column. */}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-ink">Stylist levels</h3>
            <ul aria-label="Stylist levels" className="flex flex-col gap-1.5" data-testid="level-legend">
              {[...STAFF_LEVELS].reverse().map((l) => (
                <li key={l} className="flex items-center gap-2">
                  <LevelBadge level={l} className="size-4.5" />
                  {LEVEL_LABELS[l]}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

// Background for a block's parts: its fill (the service color, or where
// the client is in their visit), lighter while processing, with stripes.
function segmentStyle(kind: string, visit: Visit): React.CSSProperties {
  // --visit-fill comes from data-visit on the block (globals.css).
  if (kind !== "processing") return { backgroundColor: "var(--visit-fill)" };
  return {
    backgroundColor: `color-mix(in srgb, var(--visit-fill) ${visit === "upcoming" ? 45 : 65}%, white)`,
    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--fam-accent) 12%, transparent) 6px 12px)",
  };
}

// Blocked time in a stylist's column: neutral, under appointments, and
// not bookable. Drag to move it; drag its bottom edge to resize.
// An event's hold on a team member's day, as one block: the event's name
// and time (call time to done, with travel each way hatched at the ends on
// location). It opens the event; it moves only with the event.
function EventHoldBox({ block, y, columnName }: { block: TimeBlockData; y: (minute: number) => number; columnName: string }) {
  const PX_PER_MINUTE = usePpm();
  const height = (block.end - block.start) * PX_PER_MINUTE;
  const time = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const title = block.event?.title ?? block.note ?? "Event";
  const travel = block.event?.travelMinutes ?? 0;
  const label = [`Event: ${title}`, time, travel ? `including ${formatDuration(travel)} travel each way` : null, columnName].filter(Boolean).join(", ");
  const hatch = "repeating-linear-gradient(45deg, transparent 0 4px, rgb(23 39 59 / 0.12) 4px 8px)";
  const body = (
    <>
      {travel > 0 && <span aria-hidden data-travel className="absolute inset-x-0 top-0" style={{ height: travel * PX_PER_MINUTE, backgroundImage: hatch }} />}
      {travel > 0 && <span aria-hidden data-travel className="absolute inset-x-0 bottom-0" style={{ height: travel * PX_PER_MINUTE, backgroundImage: hatch }} />}
      <span className="relative block truncate font-semibold text-ink" style={{ marginTop: travel > 0 && height > 60 ? travel * PX_PER_MINUTE : 0 }}>
        {title}
      </span>
      {height >= 34 && <span className="relative block truncate text-block-ink-muted">{time}</span>}
      {height >= 50 && travel > 0 && <span className="relative block truncate text-block-ink-muted">Travel {travel}m each way</span>}
    </>
  );
  const className =
    "absolute inset-x-1 z-[5] overflow-hidden rounded-md border-l-4 border-lavender-accent bg-lavender-fill px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-focus";
  const style = { top: y(block.start), height };
  return block.event ? (
    <Link href={`/events/${block.event.id}`} aria-label={label} title={label} data-time-block="event" className={className} style={style}>
      {body}
    </Link>
  ) : (
    <div aria-label={label} title={label} data-time-block="event" className={className} style={style}>
      {body}
    </div>
  );
}

function TimeBlockBox({
  block,
  y,
  editable,
  dragging,
  selected,
  columnName,
  labelOnTop,
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
  // No appointment over its label, so the label can sit above the
  // current-time line (the line passes behind the text).
  labelOnTop: boolean;
  onOpen: () => void;
  onPointerDown: (e: React.PointerEvent, b: TimeBlockData, mode: "move" | "resize") => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}) {
  const PX_PER_MINUTE = usePpm();
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
      className={`absolute inset-x-1 touch-pan-x touch-pan-y overflow-hidden [-webkit-touch-callout:none] rounded-md border border-dashed border-line-strong px-2 py-1 text-xs text-ink-muted select-none transition-[box-shadow] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-focus ${
        editable ? "cursor-grab" : "cursor-pointer"
      } ${selected ? "ring-2 ring-link/70 ring-inset" : ""} ${dragging ? "z-40 shadow-lift" : ""}`}
      style={{
        top: y(block.start),
        height,
        backgroundColor: "var(--color-sunken)",
      }}
    >
      {height >= 18 && (
        <span data-block-label className={`flex w-fit max-w-full items-center gap-1 rounded-sm bg-sunken font-semibold text-ink ${labelOnTop ? "relative z-[21]" : ""}`}>
          {block.weekdays && (
            <svg aria-hidden viewBox="0 0 24 24" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.6L4 16M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {BLOCK_LABELS[block.kind]}
          {height >= 34 ? null : <span className="font-normal text-ink-muted"> · {time}</span>}
        </span>
      )}
      {height >= 34 && <span className={`block w-fit max-w-full truncate rounded-sm bg-sunken ${labelOnTop ? "relative z-[21]" : ""}`}>{time}</span>}
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

// Where the dragged block will land: a copy on the grid lines (no scaling,
// so its edges sit exactly on them), with the new time and stylist.
function DragGhost({ block, start, stylist, y }: { block: BlockData; start: number; stylist: string; y: (minute: number) => number }) {
  const PX_PER_MINUTE = usePpm();
  const length = block.end - block.start;
  return (
    <div
      data-drag-ghost
      data-family={block.family}
      aria-hidden
      className="pointer-events-none absolute inset-x-1 z-40 overflow-hidden rounded-md border-l-4 border-(--fam-accent) bg-(--fam-fill) px-2 py-1 text-sm text-(--fam-ink) shadow-lift ring-2 ring-link"
      style={{ top: y(start), height: length * PX_PER_MINUTE }}
    >
      <div className="truncate font-semibold">{block.clientName}</div>
      <div className="truncate text-[13px] font-medium">
        {formatMinute(start)}–{formatMinute(start + length)} · {stylist}
      </div>
    </div>
  );
}

// Where the client is in their visit, as the block's fill: the service
// color until they're here, then yellow (checked in), the service color
// slightly faded with a check (checked out), or grey and struck through
// (no-show). The service color stays as the
// stripe down the left edge.
type Visit = "upcoming" | "here" | "done" | "off";

const visitOf = (status: BlockData["status"]): Visit =>
  status === "checked_in" ? "here" : status === "completed" ? "done" : status === "no_show" || status === "canceled" ? "off" : "upcoming";

// Line heights in a block, in px.
const NAME_LINE = 18;
const LINE = 17;

function AppointmentBlock({
  block,
  y,
  lateBy,
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
  squeezed,
  ...pointer
}: {
  block: BlockData & { lane: number; lanes: number };
  y: (minute: number) => number;
  // Minutes past its start with the client not checked in yet.
  lateBy: number | null;
  draggable: boolean;
  dragging: boolean;
  selected: boolean;
  // Denise is showing a fix for it.
  highlight: boolean;
  // In the same group booking as the selected visit.
  grouped: boolean;
  // The stylist's name, for the tooltip.
  stylist: string;
  // Shows (or, with null, hides) the tooltip of the visit's details.
  onHint: (details: string[] | null, rect: DOMRect) => void;
  settling: boolean;
  onSettled: () => void;
  onOpen: () => void;
  // Fit all: a narrow column, so just the name (the rest is in the tooltip).
  squeezed: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}) {
  const PX_PER_MINUTE = usePpm();
  const time = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const processing = block.segments.find((s) => s.kind === "processing");
  const height = (block.end - block.start) * PX_PER_MINUTE;
  const box = laneBox(block.lane, block.lanes);
  // A side lane (a client in another's processing gap) is narrow.
  const narrow = block.lane > 0;
  const visit = visitOf(block.status);
  const late = lateBy !== null;
  // Past the grace period: "Not arrived", not a growing count.
  const notArrived = late && lateBy >= NOT_ARRIVED_MINUTES;
  const lateText = notArrived ? "not arrived" : lateBy ? `${formatDuration(lateBy)} late` : "due now";

  // Only lines that fit whole: name, service, then time.
  let room = height - 6;
  const show = { name: room >= NAME_LINE, service: false, time: false, serviceLines: 1 as 1 | 2 };
  if (show.name) room -= NAME_LINE;
  if (room >= LINE) {
    show.service = true;
    room -= LINE;
  }
  if (room >= LINE) {
    show.time = true;
    room -= LINE;
  }
  // Leftover room lets a long service name wrap rather than shorten.
  if (show.service && room >= LINE) show.serviceLines = 2;
  if (squeezed) show.service = show.time = false;
  // A short block puts the time on the name line.
  const timeOnName = show.name && !show.time && !squeezed;
  // The name comes first; in a block shared with another lane there's no
  // room for the lateness too (it's in the tooltip).
  const showLate = late && block.lanes === 1;

  // Shorter forms for narrow spaces, longest first. The name always leads,
  // never initials, and the time is always the whole range (shortened).
  const [first, ...rest] = block.clientName.split(" ");
  const ranges = timeRangeVariants(block.start, block.end);
  const names = timeOnName
    ? ranges.map((r) => `${first} · ${r}`)
    : [block.clientName, ...(rest.length ? [`${first} ${firstLetter(rest.at(-1)!)}.`, first] : [])];
  // The visit's other services, when stylists share it.
  const others = block.parts.filter((p) => p.start !== block.start || p.service !== block.service);
  // Everything about the visit, for the tooltip.
  const details = [
    block.clientName,
    block.service,
    `${time} · ${stylist}`,
    [STATUS_LABELS[block.status], late && lateText, block.group && block.group.label, block.series && "repeating", block.online && "booked online", block.member]
      .filter(Boolean)
      .join(" · "),
    ...(others.length ? ["Whole visit:", ...block.parts.map((p) => `${p.service} · ${p.staff}, ${formatMinute(p.start)}–${formatMinute(p.end)}`)] : []),
    ...(block.allergies ? [`Allergies: ${block.allergies}`] : []),
  ];
  const plainService = block.service.replace(/\s*\([^)]*\)/g, "");
  // This stylist's part of the visit only; the rest is in the tooltip.
  const services = [...new Set([...(block.group ? [`${block.service} · ${block.group.label}`] : []), block.service, plainService])];

  const label = [
    time,
    block.clientName,
    block.service,
    processing && `processing ${formatMinute(processing.start)}–${formatMinute(processing.end)}`,
    others.length > 0 && `part of a visit with ${[...new Set(others.map((p) => p.staff))].join(" and ")}`,
    block.resource,
    block.series && "repeating",
    block.group && `group: ${block.group.label}`,
    block.online && "booked online",
    block.member,
    STATUS_LABELS[block.status],
    late && (notArrived ? "not arrived" : "running late"),
    block.allergies && `allergies: ${block.allergies}`,
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
        data-visit={visit}
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
        onMouseEnter={(e) => onHint(details, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={(e) => onHint(null, e.currentTarget.getBoundingClientRect())}
        onFocus={(e) => onHint(details, e.currentTarget.getBoundingClientRect())}
        onBlur={(e) => onHint(null, e.currentTarget.getBoundingClientRect())}
        aria-describedby={`hint-${block.itemId}`}
        {...pointer}
        className={`@container absolute block touch-pan-x touch-pan-y overflow-hidden [-webkit-touch-callout:none] rounded-md border-l-4 border-(--fam-accent) bg-surface text-left text-(--visit-ink) select-none transition-[transform,box-shadow,opacity] duration-(--motion-fast) ease-out hover:z-30 hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
 selected || highlight || grouped ? "" : "ring-1 ring-surface"
 } ${draggable ? "cursor-grab" : "cursor-pointer"} ${dragging ? "opacity-40 shadow-none outline-2 outline-ink-subtle outline-dashed" : ""} ${settling ? "animate-settle" : ""}`}
        style={{
          top: y(block.start),
          height,
          left: `calc(${box.left}% + ${block.lane > 0 ? 1 : 3}px)`,
          width: `calc(${box.width}% - ${block.lanes > 1 ? 4 : 6}px)`,
          zIndex: 10 + block.lane,
        }}
      >
        {block.segments.map((s) => (
          <span
            key={s.kind}
            aria-hidden
            data-segment={s.kind}
            className="absolute inset-x-0"
            style={{ top: (s.start - block.start) * PX_PER_MINUTE, height: (s.end - s.start) * PX_PER_MINUTE, ...segmentStyle(s.kind, visit) }}
          />
        ))}
        {/* The selection (and Denise's or a group's outline) is drawn inside
            the block, over its segments, so it never covers a neighbor. */}
        {(selected || highlight || grouped) && (
          <span
            aria-hidden
            data-ring={selected ? "selected" : highlight ? "denise" : "group"}
            className={`pointer-events-none absolute inset-0 z-10 rounded-md ring-inset ${selected ? "ring-2 ring-link/70" : highlight ? "animate-glow ring-2 ring-denise-500" : "ring-2 ring-navy-700/50"}`}
          />
        )}
        {show.name && (
          <span aria-hidden className={`relative flex items-center gap-1 pt-1 ${narrow ? "px-1.5" : "px-2"}`}>
            <FitText variants={names} className={`flex-1 text-sm leading-[18px] font-semibold ${visit === "off" ? "text-block-ink-muted line-through" : ""}`} />
            {/* Only what needs attention right now. */}
            {showLate && (
              // The name wins: in a narrow block the words go, then the
              // clock (it's all in the tooltip).
              <span
                data-attention={notArrived ? "not-arrived" : "late"}
                title={notArrived ? `Not arrived: due ${formatMinute(block.start)}` : lateBy ? `Running ${formatDuration(lateBy)} late` : "Due now, not here yet"}
                className="hidden shrink-0 items-center gap-0.5 text-xs leading-4 font-semibold whitespace-nowrap text-block-attention @min-[6.5rem]:flex"
              >
                <ClockIcon className="size-3.5" />
                {(notArrived || lateBy) && <span className={notArrived ? "hidden @min-[11rem]:inline" : "hidden @min-[8.5rem]:inline"}>{notArrived ? "Not arrived" : `+${lateBy}m`}</span>}
              </span>
            )}
            {/* Checked out: a check, which goes before the name does. */}
            {visit === "done" && (
              <span data-checked-out title="Checked out" className="hidden shrink-0 text-(--visit-ink-muted) @min-[6.5rem]:flex">
                <CheckIcon className="size-3.5" />
              </span>
            )}
          </span>
        )}
        {show.service && (
          <span aria-hidden className={`relative block ${narrow ? "px-1.5" : "px-2"}`}>
            <FitText variants={services} lines={show.serviceLines} className="text-[13px] leading-[17px] text-(--visit-ink-muted)" />
          </span>
        )}
        {show.time && (
          <span aria-hidden className={`relative block ${narrow ? "px-1.5" : "px-2"}`}>
            <FitText variants={ranges} className="text-[13px] leading-[17px] text-(--visit-ink-muted)" />
          </span>
        )}
      </div>
    </li>
  );
}

type MoreItem = { label: string; href?: string; onSelect?: () => void };

// "More" in the toolbar: Waitlist, Walk-ins and Block time, so New booking
// and New sale stay in view. Arrow keys move through it; Escape or a click
// outside closes it.
function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Focus moves into the menu only when it was opened from the keyboard (a
  // click from Enter or Space has no detail), so a mouse never leaves a ring.
  const byKeys = useRef(false);
  useKeepOnScreen(menu, open);
  useEffect(() => {
    if (!open) return;
    if (byKeys.current) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  if (!items.length) return null;
  const itemClass =
    "flex w-full items-center rounded-md px-3 py-2 text-left text-sm whitespace-nowrap text-ink transition-colors duration-(--motion-fast) hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none";
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
          button.current?.focus();
          return;
        }
        if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
        e.preventDefault();
        const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const i = all.indexOf(document.activeElement as HTMLElement);
        all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
      }}
    >
      <button ref={button} type="button" className={buttonClass("secondary", "lg")} aria-haspopup="menu" aria-expanded={open} onClick={(e) => {
          byKeys.current = e.detail === 0;
          setOpen(!open);
        }}>
        More
        <ChevronDownIcon className={`size-4 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="More" className="absolute top-full right-0 z-50 mt-2 flex min-w-44 origin-top-right animate-pop-in flex-col rounded-lg border border-line bg-surface p-1.5 shadow-lift">
          {items.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} role="menuitem" tabIndex={-1} className={itemClass} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
