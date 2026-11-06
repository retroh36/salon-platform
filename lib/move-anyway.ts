// Dragging a visit anywhere on the calendar: what's in the way where it
// lands, and the question staff answer before it goes there anyway. The
// board works these out while the visit is dragged (the preview turns
// amber with the reason) and asks on drop; the server says the same when
// the calendar changed under the drag. Pure: our wording, never Denise's.

import type { TimeBlockKind } from "./scheduling/blocks.ts";

export type DropIssue =
  | { kind: "not_offered"; stylist: string; service: string }
  | { kind: "role"; stylist: string; role: string; service: string }
  | { kind: "overlap"; stylist: string; client: string }
  | { kind: "blocked"; stylist: string; block: TimeBlockKind }
  | { kind: "hours"; stylist: string }
  | { kind: "chair" };

const BLOCK_WORDS: Record<TimeBlockKind, string> = {
  lunch: "lunch",
  break: "a break",
  training: "training",
  meeting: "a meeting",
  personal: "personal time",
  event: "an event",
};

// One short line for the preview while dragging: "Gil has Lillian then".
export function issueText(issue: DropIssue): string {
  switch (issue.kind) {
    case "not_offered":
      return `${issue.stylist} doesn't usually do ${issue.service}`;
    case "role":
      return `${issue.stylist} is on ${issue.role} then, which doesn't include ${issue.service}`;
    case "overlap":
      return `${issue.stylist} has ${issue.client} then`;
    case "blocked":
      return `${issue.stylist} has ${BLOCK_WORDS[issue.block]} then`;
    case "hours":
      return `Outside ${issue.stylist}'s hours`;
    case "chair":
      return "No chair is free then";
  }
}

// What's asked on drop: each reason as a sentence, then "Double-book
// anyway?" when it lands on another client, else "Move anyway?". Null when
// nothing's in the way (it drops at once).
export function anywayQuestion(issues: readonly DropIssue[]): { text: string; action: string } | null {
  if (!issues.length) return null;
  const sentences = issues.map((i) => `${issueText(i)}.`).join(" ");
  const action = issues.some((i) => i.kind === "overlap") ? "Double-book anyway" : "Move anyway";
  return { text: `${sentences} ${action}?`, action };
}

// Overlap of two half-open spans, in minutes.
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

type Span = { start: number; end: number };
type Segment = Span & { kind: "active" | "processing" | "finishing" };

// What a visit dragged to `start` in a stylist's column would run into,
// from what the calendar shows: the service they don't usually do, another
// client in their busy time (processing gaps are free, on either side),
// blocked time, and time outside their hours. Wall-clock minutes.
export function dropIssues(input: {
  stylist: string;
  offersService: boolean;
  service: string;
  // The dragged visit's segments where they are now, and how far it moves.
  segments: readonly Segment[];
  shift: number;
  others: readonly { client: string; segments: readonly Segment[] }[];
  blocks: readonly (Span & { kind: TimeBlockKind })[];
  unavailable: readonly Span[];
}): DropIssue[] {
  const moved = input.segments.map((s) => ({ ...s, start: s.start + input.shift, end: s.end + input.shift }));
  const busy = moved.filter((s) => s.kind !== "processing");
  const whole = { start: Math.min(...moved.map((s) => s.start)), end: Math.max(...moved.map((s) => s.end)) };
  const issues: DropIssue[] = [];
  if (!input.offersService) issues.push({ kind: "not_offered", stylist: input.stylist, service: input.service });
  const other = input.others.find((o) => o.segments.some((s) => s.kind !== "processing" && busy.some((b) => overlaps(s, b))));
  if (other) issues.push({ kind: "overlap", stylist: input.stylist, client: other.client });
  const block = input.blocks.find((b) => busy.some((s) => overlaps(s, b)));
  if (block) issues.push({ kind: "blocked", stylist: input.stylist, block: block.kind });
  if (input.unavailable.some((u) => overlaps(u, whole))) issues.push({ kind: "hours", stylist: input.stylist });
  return issues;
}
