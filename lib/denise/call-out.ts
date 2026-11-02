// "Nola called out", "Gil has to leave at 1": a stylist out, read by our
// code (no Claude), so Denise can open "Mark … out" on the calendar for
// them. "Gil is running 20 minutes late" the same way, for "Running
// late…". Pure.

export type CallOutRead = { staffId: string; firstName: string; from: number | null };

const OUT = /\b(called (out|in sick)|calling out|is (out|off|sick|ill|not coming( in)?)|out sick|off sick|can'?t (come|make it)( in)?|went home|has gone home|isn'?t coming( in)?)\b/i;
const LEAVES = /\b(has to|needs to|needs|is going to|will|is|must|wants to)?\s*(leave|leaving|go home|going home|head out|heading out|be gone|out)\s*(at|from|after|by)\s*(noon|\d{1,2}(:\d{2})?\s*(am|pm|a|p)?)\b/i;

// "1" or "1pm" or "13:00" or "noon", as minutes; a bare 1 to 7 is the
// afternoon (the salon's day).
export function minuteOf(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === "noon") return 12 * 60;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  const half = m[3]?.[0];
  if (half === "p" && hour < 12) hour += 12;
  if (half === "a" && hour === 12) hour = 0;
  if (!half && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + minute;
}

export function readCallOut(text: string, stylists: readonly { id: string; firstName: string }[]): CallOutRead | null {
  const line = text.slice(0, 300);
  const named = stylists.filter((s) => new RegExp(`\\b${s.firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line));
  if (named.length !== 1) return null;
  const leaves = LEAVES.exec(line);
  if (leaves) {
    const from = minuteOf(leaves[4]);
    return from === null ? null : { staffId: named[0].id, firstName: named[0].firstName, from };
  }
  return OUT.test(line) ? { staffId: named[0].id, firstName: named[0].firstName, from: null } : null;
}

export type RunningLateRead = { staffId: string; firstName: string; minutes: number | null };

const RUNNING_LATE = /\b(running|is|'s|are)\b.*\b(late|behind)\b|\b(late|behind) by\b/i;
const MINUTES = /\b(\d{1,3})\s*(m|mins?|minutes?)\b|\b(?:late|behind) by (\d{1,3})\b/i;

// A stylist running late, said as a statement ("Is Gil running late?" is
// a question for Ask Denise), with how late when it's said.
export function readRunningLate(text: string, stylists: readonly { id: string; firstName: string }[]): RunningLateRead | null {
  const line = text.slice(0, 300).trim();
  if (line.endsWith("?") || /^(is|are|was|how|why|when|will|who)\b/i.test(line)) return null;
  if (!RUNNING_LATE.test(line) || /\bcoming in late\b/i.test(line)) return null;
  // "Gil's client is running late", "Gil's 11 o'clock…": a client, for the
  // booking's own Running late.
  if (/\bclients?\b|'s\s+\d/i.test(line)) return null;
  const named = stylists.filter((s) => new RegExp(`\\b${s.firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line));
  if (named.length !== 1) return null;
  const m = MINUTES.exec(line);
  const said = m ? Number(m[1] ?? m[3]) : /\bhalf an hour\b/i.test(line) ? 30 : /\ban hour\b/i.test(line) ? 60 : null;
  return { staffId: named[0].id, firstName: named[0].firstName, minutes: said !== null && said > 0 ? said : null };
}
