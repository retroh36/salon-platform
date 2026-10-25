// The Events board (pure): which column an event is in. Inquiry, Proposal
// sent, Booked and Trial done are its status; a booked event whose day has
// come is Event day until it's completed; Lost sits apart.

import type { LocalDate } from "../scheduling/time.ts";
import type { EventStatus } from "./types.ts";

export type PipelineColumn = "inquiry" | "proposal_sent" | "booked" | "trial_done" | "event_day" | "completed" | "lost";

export const PIPELINE: { key: Exclude<PipelineColumn, "lost">; label: string }[] = [
  { key: "inquiry", label: "Inquiry" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "booked", label: "Booked" },
  { key: "trial_done", label: "Trial done" },
  { key: "event_day", label: "Event day" },
  { key: "completed", label: "Completed" },
];

export function pipelineColumn(status: EventStatus, date: LocalDate, today: LocalDate): PipelineColumn {
  if ((status === "booked" || status === "trial_done") && date <= today) return "event_day";
  return status;
}
