// What Denise shows on the calendar: the day's conflicts with her fixes,
// and gentle notices. Plain data, from the server to the calendar.

import type { ConflictKind } from "@/lib/scheduling/resolve";

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
  // "Priya's running 20 minutes late."
  headline: string;
  // Items to highlight: what caused it and who's affected.
  itemIds: string[];
  // "Ava Chen is already checked in, so I've left that visit as it is."
  note: string | null;
  options: FixView[];
};

export type DeniseNotice = { id: string; appointmentId: string; itemId: string; text: string };

export type DeniseState = {
  date: string;
  conflicts: ConflictView[];
  notices: DeniseNotice[];
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
