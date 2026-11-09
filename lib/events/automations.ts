// Event automations (pure): what each one says, the salon's message filled
// in by our code (never Denise), and what's wrong with one before it's
// saved (as save_event_automation).

export const EVENT_TRIGGERS = {
  inquiry_received: "An inquiry comes in",
  proposal_signed: "The proposal is signed",
  deposit_paid: "The deposit is paid",
  days_before: "Days before the event",
} as const;
export type EventTrigger = keyof typeof EVENT_TRIGGERS;

export const EVENT_ACTIONS = {
  message: "Send the client a message",
  task: "Add a to-do for the team",
  move_stage: "Move the event to a stage",
} as const;
export type EventAction = keyof typeof EVENT_ACTIONS;

export type EventAutomation = {
  id: string;
  name: string;
  trigger: EventTrigger;
  daysBefore: number | null;
  waitDays: number;
  action: EventAction;
  subject: string | null;
  body: string | null;
  task: string | null;
  stageId: string | null;
  enabled: boolean;
  approved: boolean;
};

export const MESSAGE_FIELDS = ["first_name", "salon", "event", "event_date"] as const;
export type MessageFacts = Record<(typeof MESSAGE_FIELDS)[number], string>;

export function renderEventMessage(text: string, facts: MessageFacts): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (key in facts ? facts[key as keyof MessageFacts] : all));
}

export function automationProblem(a: Pick<EventAutomation, "name" | "trigger" | "daysBefore" | "waitDays" | "action" | "body" | "task" | "stageId">): string | null {
  if (!a.name.trim() || a.name.trim().length > 80) return "Give it a name of up to 80 characters.";
  if (a.trigger === "days_before" && !(Number.isInteger(a.daysBefore) && a.daysBefore! >= 1 && a.daysBefore! <= 365)) return "Say how many days before (1 to 365).";
  if (!(Number.isInteger(a.waitDays) && a.waitDays >= 0 && a.waitDays <= 60)) return "Wait between 0 and 60 days.";
  if (a.action === "message") {
    const body = a.body?.trim() ?? "";
    if (!body) return "Write the message.";
    if (body.length > 1600) return "Keep the message under 1,600 characters.";
    const unknown = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).find((k) => !(MESSAGE_FIELDS as readonly string[]).includes(k));
    if (unknown) return `{${unknown}} isn't something we can fill in.`;
  }
  if (a.action === "task" && !a.task?.trim()) return "Say what the to-do is.";
  if (a.action === "move_stage" && !a.stageId) return "Choose one of your own stages.";
  return null;
}

// "2 days after the deposit is paid", "30 days before the event".
export function whenText(a: Pick<EventAutomation, "trigger" | "daysBefore" | "waitDays">): string {
  if (a.trigger === "days_before") return `${a.daysBefore} day${a.daysBefore === 1 ? "" : "s"} before the event`;
  const what = EVENT_TRIGGERS[a.trigger].charAt(0).toLowerCase() + EVENT_TRIGGERS[a.trigger].slice(1);
  return a.waitDays ? `${a.waitDays} day${a.waitDays === 1 ? "" : "s"} after ${what}` : `When ${what}`;
}
