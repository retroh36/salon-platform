// "Nola called out", "Gil has to leave at 1": a stylist out, read by our
// code (no Claude), so Denise can open the sick-day rescue for them. Pure.

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
