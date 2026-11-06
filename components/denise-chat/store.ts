"use client";

// Denise's conversation, shared by her chat everywhere: the bubble on every
// staff page (./bubble.tsx) and her tab on the calendar. It lives outside
// any one page, so it carries on when staff move between pages (and a
// reply still on its way arrives on the next page), and it's kept in this
// tab's session storage for each signed-in person, so a reload or a
// full-page link (the checkout) doesn't lose it either. Someone else
// signing in on the same iPad starts with an empty chat.

import { useSyncExternalStore } from "react";
import { ERROR_REPLY } from "@/lib/denise/respond";
import { stateOf } from "@/lib/denise/booking-chat";
import type { ChatMessage, DeniseEvent, DeniseRequest } from "@/lib/denise/types";
import type { PageRef } from "@/lib/denise/page";

export type DeniseRun = {
  working: boolean;
  // What she's doing now ("Checking Bridget's openings…").
  status: string | null;
  // Her answer so far, as it streams in.
  text: string;
  // Over 8 seconds: "Still thinking…".
  slow: boolean;
};

// `stopped`: she took too long and the request was stopped (STOP_MS).
export type Done = Extract<DeniseEvent, { t: "done" }> & { stopped?: boolean };

// "Open in the booking form" from a booking card: picked up by the calendar.
export type Adjust = { date: string; lines: { serviceId: string; staffId: string; startMinute: number; minutes?: number; requested?: boolean }[]; client: { id: string; name: string; phone: string | null; allergies: string | null } | null };

type State = {
  staffId: string | null;
  chat: ChatMessage[];
  run: DeniseRun;
  // The bubble's panel (pages other than the calendar).
  open: boolean;
  // Bumped to open her and put the cursor in her message box.
  focus: number;
  // Her compact card shrunk to a small bar (Scheduling; components/denise-chat/card.tsx).
  min: boolean;
  adjust: Adjust | null;
  // A question put in her message box for staff to send (Meet Denise's
  // samples), with the focus it came with.
  prefill: { text: string; at: number } | null;
};

const IDLE: DeniseRun = { working: false, status: null, text: "", slow: false };
export const SLOW_MS = 8_000;
// Past this with no answer started, she stops and says so, with Try again:
// a question never hangs. Once her words are coming in, she's given until
// GIVE_UP_MS to finish.
export const STOP_MS = 25_000;
export const GIVE_UP_MS = 150_000;
export const TOO_SLOW_TEXT = "That's taking me too long, so I stopped. Nothing was changed. Try again, or ask it a shorter way.";
// For a report (running late, out, a cancellation): what was reported is
// already saved, and the calendar looks over the day again by itself.
const TOO_SLOW_REPORT = "That's taking me too long, so I stopped looking. What you told me is saved, and I'll look over the day again in a moment.";
// The most messages kept.
const KEEP = 40;
const PREFIX = "maestra:denise:";

const EMPTY: State = { staffId: null, chat: [], run: IDLE, open: false, focus: 0, min: false, adjust: null, prefill: null };
let state: State = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ("chat" in patch || "open" in patch || "min" in patch) save();
  for (const l of listeners) l();
}

function save() {
  if (!state.staffId) return;
  try {
    sessionStorage.setItem(PREFIX + state.staffId, JSON.stringify({ chat: state.chat.slice(-KEEP), open: state.open, min: state.min }));
  } catch {
    // Private mode or full: the chat still works on this page.
  }
}

// Her chat for whoever's signed in: theirs from this tab's storage, and
// nobody else's left behind.
export function hydrateDenise(staffId: string) {
  if (state.staffId === staffId) return;
  let saved: { chat?: ChatMessage[]; open?: boolean; min?: boolean } = {};
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX) && key !== PREFIX + staffId) sessionStorage.removeItem(key);
    }
    saved = JSON.parse(sessionStorage.getItem(PREFIX + staffId) ?? "{}");
  } catch {
    saved = {};
  }
  state = { ...EMPTY, staffId, chat: Array.isArray(saved.chat) ? saved.chat : [], open: saved.open === true, min: saved.min === true };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDenise(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

export const setDeniseOpen = (open: boolean) => set(open ? { open } : { open, min: false });
export const setDeniseMin = (min: boolean) => set({ min });
// Opens her with the cursor in her message box (the keyboard shortcut).
export const focusDenise = () => set({ open: true, min: false, focus: state.focus + 1 });
// Opens her with a question typed in her box, not sent: staff send it.
export const askDeniseAbout = (question: string) => set({ open: true, min: false, focus: state.focus + 1, prefill: { text: question, at: state.focus + 1 } });
export const clearPrefill = () => set({ prefill: null });
export const appendDenise = (message: ChatMessage) => set({ chat: [...state.chat, message].slice(-KEEP) });
export const updateDenise = (index: number, patch: Partial<ChatMessage>) => set({ chat: state.chat.map((m, i) => (i === index ? { ...m, ...patch } : m)) });
export const requestAdjust = (adjust: Adjust) => set({ adjust });
export function takeAdjust(): Adjust | null {
  const adjust = state.adjust;
  if (adjust) set({ adjust: null });
  return adjust;
}

// Asks Denise (app/api/denise) and follows along as she works. Always ends
// with a reply: if the request fails, hers is "Something went wrong on my
// end" (the server logs what happened). One at a time.
export async function startDenise(request: DeniseRequest, firstStatus: string): Promise<Done> {
  set({ run: { working: true, status: firstStatus, text: "", slow: false } });
  const run = (patch: Partial<DeniseRun> | ((r: DeniseRun) => Partial<DeniseRun>)) => set({ run: { ...state.run, ...(typeof patch === "function" ? patch(state.run) : patch) } });
  const stop = new AbortController();
  let stopped = false;
  const timers = [
    setTimeout(() => run({ slow: true }), SLOW_MS),
    setTimeout(() => {
      if (state.run.text) return;
      stopped = true;
      stop.abort();
    }, STOP_MS),
    setTimeout(() => stop.abort(), GIVE_UP_MS),
  ];
  try {
    const response = await fetch("/api/denise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: stop.signal });
    if (!response.ok || !response.body) return { t: "done", reply: ERROR_REPLY };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: Done | null = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line) as DeniseEvent;
        if (event.t === "status") run({ status: event.text });
        else if (event.t === "text") run((r) => ({ text: r.text + event.text }));
        else if (event.t === "discard") run({ text: "" });
        else done = event;
      }
    }
    return done ?? { t: "done", reply: ERROR_REPLY };
  } catch {
    return stopped ? { t: "done", reply: { text: request.action === "ask" ? TOO_SLOW_TEXT : TOO_SLOW_REPORT, kind: "error" }, stopped: true } : { t: "done", reply: ERROR_REPLY };
  } finally {
    for (const t of timers) clearTimeout(t);
    set({ run: IDLE });
  }
}

// A question from staff: on the chat at once, then her reply, with any
// booking card. A follow-up carries the last booking card's request, and
// the question says which page it's from.
export async function askDenise(question: string, where: { date: string; page: PageRef }): Promise<Done | null> {
  if (state.run.working) return null;
  const card = [...state.chat].reverse().find((m) => m.role === "denise" && m.booking)?.booking;
  const history: ChatMessage[] = [...state.chat, { role: "user", text: question }];
  set({ chat: history.slice(-KEEP) });
  // Only what the conversation needs goes back: the words.
  const words = history.slice(-12).map((m) => ({ role: m.role, text: m.text }));
  const done = await startDenise({ action: "ask", date: where.date, history: words, page: where.page, booking: card ? stateOf(card) : null }, "Reading your question…");
  appendDenise({ role: "denise", text: done.reply.text, suggestions: done.suggestions, links: done.links, booking: done.booking, tasks: done.tasks, retry: done.stopped ? question : undefined });
  return done;
}
