// What Denise says when something triggers her: a stylist out, a visit
// running over or a client running late, a cancellation. She always says
// something: the fixes she found, why there's nothing to do, or what staff
// can do when she can't find a fix. Wording only, from facts our code
// worked out (no Claude). Pure.

import { formatMinute } from "@/lib/scheduling/time";

export type ReplyKind = "fixes" | "nothing" | "stuck" | "error";
export type Reply = { text: string; kind: ReplyKind };

export const ERROR_REPLY: Reply = {
  text: "Something went wrong on my end. Anything you changed is saved; I just couldn't look into it. Try again in a moment.",
  kind: "error",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ways = (n: number) => (n === 1 ? "a way" : `${n} ways`);

// The conflict a report created, if Denise found one: how many fixes.
export type Found = { options: number } | null;

export function callOutReply(f: {
  stylist: string;
  isToday: boolean;
  // Clients still to come (or in the chair) for them that day.
  clients: number;
  // Their working hours were already over when they were marked out.
  dayOver: boolean;
  found: Found;
}): Reply {
  const day = f.isToday ? "today" : "that day";
  if (f.found && f.found.options > 0) {
    return { text: `I found ${ways(f.found.options)} to cover ${f.stylist}'s ${f.clients === 1 ? "client" : plural(f.clients, "client")}. They're in my panel for you to apply.`, kind: "fixes" };
  }
  if (f.clients > 0) {
    return {
      text: `I couldn't find anyone free to take ${f.stylist}'s ${f.clients === 1 ? "client" : plural(f.clients, "client")} ${day}. You could call ${f.clients === 1 ? "them" : "each of them"} to move to another day, or ask another stylist if they can stay later.`,
      kind: "stuck",
    };
  }
  if (f.isToday && f.dayOver) {
    return { text: `${f.stylist}'s day is already over and there's no one left on ${f.stylist}'s book, so there's nothing to move. I've marked ${f.stylist} out for the rest of today.`, kind: "nothing" };
  }
  if (f.isToday) return { text: `${f.stylist} has no clients left today, so there's nothing to move. No one can book ${f.stylist} for the rest of the day.`, kind: "nothing" };
  return { text: `${f.stylist} has no clients that day, so there's nothing to move. No one can book ${f.stylist} that day.`, kind: "nothing" };
}

export function lateReply(f: {
  stylist: string;
  client: string;
  // Checked in (the visit is running over) or not (the client is late).
  checkedIn: boolean;
  minutes: number;
  isToday: boolean;
  // The stylist's next client after this visit, if any (minute of the day).
  nextStart: number | null;
  // The visit's start (minute of the day), and whether even running late
  // it should be over or under way by now (reported long after the fact).
  start: number;
  alreadyPast: boolean;
  found: Found;
}): Reply {
  if (f.alreadyPast && f.checkedIn) {
    return { text: `${f.client}'s visit should have finished by now, even running ${f.minutes} minutes over, so nothing else is affected. Check them out when they're done.`, kind: "nothing" };
  }
  if (f.alreadyPast) {
    return {
      text: `${f.client}'s ${formatMinute(f.start)} visit should have started by now, even ${f.minutes} minutes late, so there's no time left for me to move. If ${f.client} isn't coming, you could mark it a no-show, or rebook them for another day.`,
      kind: "stuck",
    };
  }
  if (f.found && f.found.options > 0) {
    return { text: `${f.checkedIn ? `${f.client}'s visit running ${f.minutes} minutes over` : `${f.client} being ${f.minutes} minutes late`} pushes into ${f.stylist}'s next client. Here's how I'd keep the day on track.`, kind: "fixes" };
  }
  if (f.found) {
    return {
      text: `I couldn't find a way to fit everyone around that. You could let ${f.stylist}'s next client know they'll wait about ${f.minutes} minutes, or offer them another time.`,
      kind: "stuck",
    };
  }
  const why = f.nextStart === null ? `${f.stylist} has no more clients ${f.isToday ? "today" : "that day"}.` : `${f.stylist}'s next client isn't until ${formatMinute(f.nextStart)}.`;
  return { text: `Nothing else is affected: ${why}`, kind: "nothing" };
}

// When she found no fix for a conflict: what staff can do instead.
export function noFixAdvice(kind: string): string {
  switch (kind) {
    case "client_late":
      return "I couldn't find a fix that works with everyone's hours and bookings. You could see if the client can come a little later, or offer them another day.";
    case "call_out":
      return "I couldn't find anyone free to take these clients. You could call them to move to another day, or ask a stylist if they can stay later.";
    default:
      return "I couldn't find a fix that works with everyone's hours and bookings. You could let the next client know they'll wait a little, or offer them another time.";
  }
}

export function canceledReply(f: { stylist: string; start: number; end: number; waitlistMatches: number }): Reply {
  const freed = `That frees ${formatMinute(f.start)}–${formatMinute(f.end)} with ${f.stylist}.`;
  if (f.waitlistMatches > 0) return { text: `${freed} ${plural(f.waitlistMatches, "client")} on your waitlist could take it.`, kind: "fixes" };
  return { text: `${freed} No one on the waitlist fits it, so it's open for booking.`, kind: "nothing" };
}
