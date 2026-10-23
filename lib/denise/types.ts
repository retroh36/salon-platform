// What Denise shows on the calendar: the day's conflicts with her fixes,
// and gentle notices. Plain data, from the server to the calendar.

import type { ConflictKind } from "@/lib/scheduling/resolve";
import type { Brief } from "./brief";

export type FixMove = {
  itemId: string;
  appointmentId: string;
  clientName: string;
  service: string;
  from: { staffId: string; minute: number };
  to: { staffId: string; minute: number };
};

export type FixView = {
  // The proposal in the AI action log; null when the viewer can't approve.
  actionId: string | null;
  // "Grace Lewis 11:00 → 11:20"
  summary: string;
  // Denise presenting it, for the top option.
  intro: string;
  // Why it works, in plain English (written by Claude when connected).
  reason: string;
  moves: FixMove[];
  clientsMoved: number;
  shiftMinutes: number;
  // Clients it couldn't find a place for.
  unresolved: string[];
};

export type ConflictView = {
  // e.g. "2026-10-21:overrun:<id>"
  subject: string;
  kind: ConflictKind;
  // "Bridget's running 20 minutes late."
  headline: string;
  // Items to highlight: what caused it and who's affected.
  itemIds: string[];
  // "Ava Chen is already checked in, so I've left that visit as it is."
  note: string | null;
  options: FixView[];
  // The same with clients' first names only, for Claude (Ask Denise).
  firstNames: { headline: string; options: string[] };
};

export type DeniseNotice = { id: string; appointmentId: string; itemId: string; text: string };

// A reorder Denise has drafted on the Inventory page.
export type ReorderNotice = {
  supplierId: string;
  supplier: string;
  headline: string;
  lines: number;
  totalCents: number;
  // The most urgent few, with why.
  items: { product: string; reason: string }[];
};

// Time that opened up, with waitlist clients who'd fit it, best first.
export type OpeningMatch = { entryId: string; clientName: string; services: string; startMinute: number; endMinute: number; preferred: boolean; waitingSince: string };
export type WaitlistOpening = { key: string; staffId: string; staffName: string; startMinute: number; endMinute: number; headline: string; matches: OpeningMatch[] };

export type DeniseState = {
  date: string;
  conflicts: ConflictView[];
  notices: DeniseNotice[];
  reorders: ReorderNotice[];
  openings: WaitlistOpening[];
  // The morning brief, for today and the front of house.
  brief: Brief | null;
  // Whether Claude is connected (ANTHROPIC_API_KEY is set).
  connected: boolean;
};

// After approving, rejecting or undoing.
export type FixResult = { ok: true; message: string; state: DeniseState } | { ok: false; message: string; state?: DeniseState };

// A booking Denise suggests from "Ask Denise", for staff to approve.
export type BookingSuggestion = {
  // The proposal in the AI action log; null when the viewer can't approve.
  actionId: string | null;
  date: string;
  staffId: string;
  staffName: string;
  serviceName: string;
  startMinute: number;
  endMinute: number;
  // The name staff mentioned, to start the client search with.
  clientHint: string | null;
};

export type ChatMessage = { role: "user" | "denise"; text: string; suggestions?: BookingSuggestion[] };

// Denise's streaming endpoint (app/api/denise/route.ts): what's asked of
// her, and what she sends back as she works, one JSON object per line.
export type DeniseRequest =
  | { action: "ask"; date: string; history: ChatMessage[] }
  | { action: "report_late"; date: string; itemId: string; minutes: number }
  | { action: "report_out"; date: string; staffId: string }
  | { action: "canceled"; date: string; appointmentId: string };

export type DeniseEvent =
  // What she's doing now ("Checking Bridget's openings…").
  | { t: "status"; text: string }
  // Her answer, word by word; "discard" drops words that turned out to be
  // a step before using a tool.
  | { t: "text"; text: string }
  | { t: "discard" }
  // Finished: what she says, and her view of the day after a report.
  | { t: "done"; reply: { text: string; kind: "fixes" | "nothing" | "stuck" | "error" }; state?: DeniseState; suggestions?: BookingSuggestion[] };
