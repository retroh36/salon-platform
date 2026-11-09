// The Events board's stages (pure): the salon's names and order over the six
// built-in stages, plus stages of its own. An event is where its status puts
// it, unless staff put it in one of the salon's own; its day coming, or any
// change of status, takes it out.

import type { LocalDate } from "../scheduling/time.ts";
import { PIPELINE, pipelineColumn, type PipelineColumn } from "./pipeline.ts";
import type { EventStatus } from "./types.ts";

export type StageKind = Exclude<PipelineColumn, "lost">;
export type EventStage = { id: string; name: string; kind: StageKind | null };

export const MAX_STAGES = 12;
const NAME_MAX = 40;

// As save_event_stages.
export function stagesProblem(stages: readonly Pick<EventStage, "name" | "kind">[]): string | null {
  if (stages.length > MAX_STAGES) return `Up to ${MAX_STAGES} stages.`;
  if (!PIPELINE.every((p) => stages.filter((s) => s.kind === p.key).length === 1)) return "The six built-in stages can be renamed and moved, not removed.";
  const names = stages.map((s) => s.name.trim().toLowerCase());
  if (names.some((n) => !n || n.length > NAME_MAX)) return `Give every stage a name of up to ${NAME_MAX} characters.`;
  if (new Set(names).size !== names.length) return "Two stages have the same name.";
  return null;
}

export function boardStage(e: { status: EventStatus; date: LocalDate; stageId: string | null }, stages: readonly EventStage[], today: LocalDate): EventStage | null {
  const place = pipelineColumn(e.status, e.date, today);
  if (place === "lost") return null;
  const own = e.stageId && place !== "event_day" ? stages.find((s) => s.id === e.stageId && !s.kind) : undefined;
  return own ?? stages.find((s) => s.kind === place) ?? null;
}
