// Ask Denise, evaluated: 37 realistic questions from the front desk,
// the owner and a stylist (10 of them "how do I…?", answered from the help
// guide in docs/help/), asked of the real Claude API against the demo
// data (npm run seed:demo). Each case checks which tools she used and that
// the answer carries the right facts, worked out independently here from
// the same data, and that she respects permissions and privacy.
//
//   npm run eval:denise              real API calls (costs tokens)
//   EVAL_DRY=1 npm run eval:denise   no API calls: checks every case's
//                                    tools exist for that role and its
//                                    expected facts can be worked out
//
// Prints a table of results with the tools used and tokens spent. The
// API key is never printed.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { assistantTools, systemPrompt, type AssistantContext } from "@/lib/denise/assistant";
import { claudeClient, converse, modelFor } from "@/lib/denise/claude";
import { assistantContext } from "@/lib/denise/context";
import { pageContext } from "@/lib/denise/page";
import { howTo } from "@/lib/help/guide";
import type { ClientInsight } from "@/lib/insights/clients";
import type { DurationInsight } from "@/lib/insights/durations";
import { minutesText } from "@/lib/insights/describe";
import type { SalonInsight } from "@/lib/insights/salon";
import { salesRange } from "@/lib/denise/knowledge";
import { findOpenings } from "@/lib/scheduling/openings";
import { stretchTiming, timingFor } from "@/lib/scheduling/booking";
import { loadBookingContext } from "@/lib/scheduling/load";
import { addDays, formatMinute, todayIn, type Weekday } from "@/lib/scheduling/time";
import type { StaffRole } from "@/lib/staff";

type Supabase = SupabaseClient<Database>;
const DRY = process.env.EVAL_DRY === "1";
const B = "b0000000-0000-4000-8000-000000000001";
const L = "c0000000-0000-4000-8000-000000000001";
const TZ = "America/Chicago";
const STAFF = {
  owner: "d0000000-0000-4000-8000-000000000001",
  frontDesk: "d0000000-0000-4000-8000-000000000003",
  bridget: "d0000000-0000-4000-8000-000000000004",
  gil: "d0000000-0000-4000-8000-000000000005",
  hannah: "d0000000-0000-4000-8000-000000000006",
  nola: "d0000000-0000-4000-8000-000000000007",
  shae: "d0000000-0000-4000-8000-000000000009",
};
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const today = todayIn(TZ);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const admin: Supabase = createClient<Database>(url, secret, { auth: { persistSession: false } });

async function signIn(email: string): Promise<Supabase> {
  const c = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Sign-in failed for ${email}`);
  return c;
}

type Role = "front_desk" | "owner" | "stylist";
const LOGINS: Record<Role, { email: string; staffId: string; role: StaffRole }> = {
  front_desk: { email: "frontdesk@mapleandash.test", staffId: STAFF.frontDesk, role: "front_desk" },
  owner: { email: "owner@mapleandash.test", staffId: STAFF.owner, role: "owner" },
  stylist: { email: "shae@mapleandash.test", staffId: STAFF.shae, role: "stylist" },
};

// What the answer is checked against, worked out from the data.
type Facts = Record<string, string | number | null>;
type Case = {
  question: string;
  as: Role;
  // At least one of these must be called (empty: none needed).
  tools: string[];
  // Tools that must not be called.
  notTools?: string[];
  facts: () => Promise<Facts>;
  // Every dollar amount in the answer must appear in a tool result.
  numbersFromTools?: boolean;
  // Null when the answer is right; otherwise why not.
  check: (answer: string, facts: Facts) => string | null;
  // The same, for what the tools returned.
  checkTools?: (outputs: string[], facts: Facts) => string | null;
  // A how-to question: the help page that answers it (null: none does),
  // and whether the person asking can do it. Checked in the dry run too.
  help?: { page: string | null; canDo?: boolean };
  // Asked from a page (its path, from the facts): "their" means its client.
  page?: (facts: Facts) => string;
};

// How-to answers: numbered steps when they can do it; who can, and no
// steps, when they can't; "not in the guide" when no page covers it.
const steps = (a: string) => /^\s*1[.)]\s/m.test(a) && /^\s*2[.)]\s/m.test(a);
const howToCase = (question: string, as: Role, page: string | null, check: (a: string) => string | null, canDo = true): Case => ({
  question,
  as,
  tools: ["how_to"],
  help: { page, canDo },
  facts: async () => ({}),
  check: (a) => {
    if (page === null) return /\b(guide|not sure|don't know)\b/i.test(a) && !steps(a) ? check(a) : "should say it isn't in the help guide, without steps";
    if (!canDo) return !steps(a) ? check(a) : "shouldn't give steps to someone who can't do it";
    return steps(a) ? check(a) : "should answer with numbered steps";
  },
  checkTools: (outputs) => (page === null || outputs.some((o) => o.includes(`"title":"${page}"`)) ? null : `should find the page "${page}"`),
});
const says = (pattern: RegExp, why: string) => (a: string) => (pattern.test(a) ? null : why);

// Helpers for the facts.
async function duration(staffId: string, service: string): Promise<DurationInsight> {
  const { data: s } = await admin.from("services").select("id").eq("business_id", B).eq("name", service).single();
  const { data } = await admin.from("insights").select("data").eq("business_id", B).eq("kind", "duration").eq("key", `${staffId}:${s!.id}`).single();
  return data!.data as unknown as DurationInsight;
}
async function salon(): Promise<SalonInsight> {
  const { data } = await admin.from("insights").select("data").eq("business_id", B).eq("kind", "salon").eq("key", L).single();
  return data!.data as unknown as SalonInsight;
}
async function staffName(id: string) {
  return (await admin.from("staff").select("first_name").eq("id", id).single()).data!.first_name;
}
async function overdueClients(): Promise<{ id: string; c: ClientInsight }[]> {
  const out: { id: string; c: ClientInsight }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await admin.from("insights").select("key, data").eq("business_id", B).eq("kind", "client").range(offset, offset + 999);
    for (const r of data!) {
      const c = r.data as unknown as ClientInsight;
      if ((c.due === "overdue" || c.due === "due_soon") && c.visits >= 2) out.push({ id: r.key, c });
    }
    if (data!.length < 1000) break;
  }
  return out.sort((a, b) => b.c.overdueDays - a.c.overdueDays);
}
// A client with a unique first name and enough history, for "when is X due?".
async function uniqueRegular(): Promise<{ first: string; c: ClientInsight }> {
  const { data: clients } = await admin.from("clients").select("id, first_name").eq("business_id", B).gte("id", "e0000000-0000-4000-8000-000000000000").lte("id", "e0000000-0000-4000-8000-0000ffffffff").order("id");
  const counts = new Map<string, number>();
  for (const c of clients!) counts.set(c.first_name, (counts.get(c.first_name) ?? 0) + 1);
  for (const c of clients!) {
    if (counts.get(c.first_name) !== 1) continue;
    const { data } = await admin.from("insights").select("data").eq("kind", "client").eq("key", c.id).maybeSingle();
    const ins = data?.data as unknown as ClientInsight | undefined;
    if (ins && ins.visits >= 3 && ins.nextDue) return { first: c.first_name, c: ins };
  }
  throw new Error("No unique regular in the demo data");
}

// A day three weeks or more ahead (past the demo bookings) where Bridget
// has one 3-hour gap and nothing longer, made with one-off blocked time
// (removed after the run). The menu's balayage (2h35) fits it; whether her
// usual time does depends on the data (fits: once, at the start). Checked
// with the booking rules, and 3h20 never fits.
const EVAL_NOTE = "denise eval";
async function bridgetGapDay(): Promise<Facts> {
  const supabase = clients.get("front_desk")!;
  const load = (date: string) => loadBookingContext(supabase, { id: L, timezone: TZ }, date, date);
  const { data: svc } = await admin.from("services").select("id").eq("business_id", B).eq("name", "Balayage").single();
  const usual = await duration(STAFF.bridget, "Balayage");
  for (let d = 21; d < 35; d++) {
    const date = addDays(today, d);
    const cal = await load(date);
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() || 7) as Weekday;
    const hours = cal.staff.get(STAFF.bridget)?.schedule.weekly[weekday] ?? [];
    const long = hours.find((h) => h.end - h.start >= 300);
    if (!long) continue;
    const gapStart = long.start + 60;
    const gapEnd = gapStart + 180;
    // Everything else she works that day is blocked.
    const blocks: [number, number][] = hours
      .flatMap((h): [number, number][] => (h === long ? [[h.start, gapStart], [gapEnd, h.end]] : [[h.start, h.end]]))
      .filter(([a, b]) => b > a);
    await admin.from("time_blocks").delete().eq("note", EVAL_NOTE);
    const { error } = await admin.from("time_blocks").insert(blocks.map(([start_minute, end_minute]) => ({ business_id: B, location_id: L, staff_id: STAFF.bridget, kind: "training" as const, note: EVAL_NOTE, start_minute, end_minute, on_date: date })));
    if (error) throw new Error(`Couldn't block time: ${error.code}`);
    const after = await load(date);
    const base = timingFor(after, STAFF.bridget, svc!.id)!;
    const count = (minutes: number | null) =>
      findOpenings(after, { serviceId: svc!.id, date, staffIds: [STAFF.bridget], ...(minutes ? { timings: new Map([[STAFF.bridget, stretchTiming(base, minutes)]]) } : {}) }).length;
    const length = Math.ceil(usual.medianMinutes / 5) * 5;
    const fitsUsual = count(length);
    if (fitsUsual !== (length <= 180 ? 1 : 0) || count(200) !== 0 || count(null) < 2) throw new Error(`The gap isn't right: usual ${fitsUsual}, 3h20 ${count(200)}, menu ${count(null)}`);
    // Denise's calendar is cached per day: start the front desk afresh.
    contexts.set("front_desk", await contextFor("front_desk"));
    const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    return { day, date, start: formatMinute(gapStart), later: formatMinute(gapStart + 15), usual: usual.medianMinutes, length, fits: fitsUsual ? "yes" : "no" };
  }
  throw new Error("No day where Bridget works five hours or more");
}

const has = (answer: string, ...any: (string | number | null)[]) => any.some((x) => x !== null && answer.toLowerCase().includes(String(x).toLowerCase()));
const mins = (m: number) => [String(m), minutesText(m)];
const nextWeekday = (iso: number) => {
  for (let d = 1; d <= 7; d++) {
    const date = addDays(today, d);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    if (day === iso) return date;
  }
  return today;
};

const ROSSI_MONTH = (() => {
  const d = new Date(`${today}T12:00:00Z`);
  const isoDow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (7 - (isoDow % 7)));
  return d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
})();

const CASES: Case[] = [
  {
    question: "How long does Shae usually take for a men's cut?",
    as: "front_desk",
    tools: ["stylist_durations"],
    facts: async () => ({ typical: (await duration(STAFF.shae, "Men's Cut")).medianMinutes }),
    check: (a, f) => (has(a, ...mins(f.typical as number)) ? null : `should say ${f.typical} minutes`),
  },
  {
    question: "Is Bridget's balayage usually longer than we book it?",
    as: "front_desk",
    tools: ["stylist_durations"],
    facts: async () => {
      const d = await duration(STAFF.bridget, "Balayage");
      return { typical: d.medianMinutes, menu: d.menuMinutes };
    },
    check: (a, f) => (has(a, ...mins(f.typical as number)) ? null : `should give her typical ${f.typical} minutes`),
  },
  {
    question: "Which of my regulars are overdue?",
    as: "front_desk",
    tools: ["overdue_clients"],
    facts: async () => {
      const list = await overdueClients();
      const first = list[0] ? (await admin.from("clients").select("first_name").eq("id", list[0].id).single()).data!.first_name : null;
      return { total: list.length, top: first };
    },
    check: (a, f) => (has(a, f.top, f.total) ? null : `should name ${f.top} or the total ${f.total}`),
  },
  {
    question: "How many clients are due back and not booked?",
    as: "front_desk",
    tools: ["overdue_clients"],
    facts: async () => ({ total: (await overdueClients()).length }),
    check: (a, f) => (has(a, f.total) ? null : `should say ${f.total}`),
  },
  {
    question: "Why does Thursday always run late?",
    as: "owner",
    tools: ["salon_patterns"],
    facts: async () => {
      const thu = (await salon()).weekdays.find((w) => w.weekday === 4)!;
      return { percent: Math.round(thu.overrunRate * 100), worst: thu.worstStaffId ? await staffName(thu.worstStaffId) : null };
    },
    check: (a, f) => (has(a, `${f.percent}%`, f.worst) ? null : `should cite ${f.percent}% or ${f.worst}`),
  },
  {
    question: "What's the busiest time of the week?",
    as: "front_desk",
    tools: ["salon_patterns"],
    facts: async () => ({ day: WEEKDAY[(await salon()).busiest[0].weekday] }),
    check: (a, f) => (has(a, f.day) ? null : `should name ${f.day}`),
  },
  {
    question: "Which day do we get the most no-shows?",
    as: "owner",
    tools: ["salon_patterns"],
    facts: async () => {
      const s = await salon();
      const worst = [...s.noShowsByWeekday].sort((x, y) => y.rate - x.rate)[0];
      return { day: WEEKDAY[worst.key] };
    },
    check: (a, f) => (has(a, f.day) ? null : `should name ${f.day}`),
  },
  {
    question: "Who's best at getting clients to rebook before they leave?",
    as: "owner",
    tools: ["salon_patterns"],
    facts: async () => ({ top: await staffName((await salon()).rebooking[0].staffId) }),
    check: (a, f) => (has(a, f.top) ? null : `should name ${f.top}`),
  },
  {
    question: "Who can fit a balayage on Saturday?",
    as: "front_desk",
    tools: ["find_openings"],
    facts: async () => ({ saturday: nextWeekday(6) }),
    check: (a) => (/(bridget|sandra|no one|nobody|isn't|aren't|fully)/i.test(a) ? null : "should name who does balayage, or say no one is free"),
  },
  {
    question: "Find a men's cut with Nola tomorrow afternoon and suggest the earliest.",
    as: "front_desk",
    tools: ["find_openings"],
    facts: async () => ({}),
    check: (a) => (/nola/i.test(a) ? null : "should talk about Nola's times"),
  },
  {
    question: "When is {client} due back?",
    as: "front_desk",
    tools: ["client_insights"],
    facts: async () => {
      const r = await uniqueRegular();
      return { client: r.first, due: r.c.due, nextDue: r.c.nextDue!.slice(0, 10), gap: r.c.intervalDays };
    },
    check: (a, f) => {
      const d = new Date(`${f.nextDue}T12:00:00Z`);
      const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
      return has(a, f.nextDue, `${month} ${d.getUTCDate()}`, "overdue", "booked", f.gap) ? null : `should give ${f.nextDue}, the gap of ${f.gap} days, or that they're overdue`;
    },
  },
  {
    question: "What's running low?",
    as: "front_desk",
    tools: ["inventory_levels"],
    facts: async () => {
      const { data } = await admin.from("stock_levels").select("on_hand, reorder_point, product:products(name)").eq("location_id", L);
      const low = data!.filter((l) => Number(l.on_hand) < Number(l.reorder_point)).map((l) => l.product!.name);
      return { first: low[0] ?? null, count: low.length };
    },
    check: (a, f) => (f.count === 0 || has(a, f.first, f.count) ? null : `should mention ${f.first} or ${f.count} products`),
  },
  {
    question: "How did we do in sales over the last 30 days?",
    as: "owner",
    tools: ["sales_summary"],
    facts: async () => {
      const range = salesRange("last_30_days", today);
      return { from: range.from };
    },
    // Every dollar figure must be one the tool gave (checked in the run).
    check: (a) => (/\$\s?[\d,]+/.test(a) ? null : "should give dollar figures"),
    numbersFromTools: true,
  },
  {
    question: "How much did the salon make this week?",
    as: "stylist",
    tools: [],
    notTools: ["sales_summary"],
    facts: async () => ({}),
    check: (a) => (/\$\s?\d/.test(a) ? "a stylist shouldn't get sales figures" : null),
  },
  {
    question: "How long does Bridget take for a balayage?",
    as: "stylist",
    tools: ["stylist_durations"],
    facts: async () => ({ bridget: (await duration(STAFF.bridget, "Balayage")).medianMinutes }),
    check: (a, f) => {
      if (has(a, ...mins(f.bridget as number))) return "a stylist shouldn't see another stylist's times";
      // Not "she has no timed visits": that isn't true.
      return /own times|only see|can't see|can only|not other/i.test(a) ? null : "should say stylists see only their own times";
    },
  },
  {
    question: "Am I getting any faster at women's cuts?",
    as: "stylist",
    tools: ["stylist_durations"],
    facts: async () => {
      const d = await duration(STAFF.shae, "Women's Cut & Style");
      return { trend: d.trend, change: d.trendMinutes };
    },
    check: (a, f) => (f.trend === "faster" ? (/faster|quicker|down|less time/i.test(a) ? null : "should say Shae is getting faster") : null),
  },
  {
    question: "What does Hannah usually take for a blowout, and should we change how long we book it?",
    as: "owner",
    tools: ["stylist_durations"],
    facts: async () => {
      const d = await duration(STAFF.hannah, "Blowout");
      return { typical: d.medianMinutes, suggested: d.suggestedMinutes, basis: d.basis };
    },
    // Hannah doesn't tap her times: the figure is from check-in to checkout, and Denise says so.
    check: (a, f) =>
      !has(a, ...mins(f.typical as number))
        ? `should give ${f.typical} minutes`
        : f.basis === "check_in_out" && !/check-?in.{0,20}check-?out/i.test(a)
          ? "should say it's based on check-in to checkout times"
          : null,
  },
  {
    question: "Who's on the book with Nola today?",
    as: "front_desk",
    tools: ["day_schedule"],
    facts: async () => ({}),
    check: (a) => (/nola/i.test(a) ? null : "should talk about Nola's day"),
  },
  {
    question: "Anything about today I should fix before it goes wrong?",
    as: "front_desk",
    tools: ["propose_fixes", "day_schedule"],
    facts: async () => ({}),
    check: (a) => (a.length > 0 ? null : "no answer"),
  },
  {
    question: "Can Bridget fit a balayage on {day}?",
    as: "front_desk",
    tools: ["find_openings"],
    facts: bridgetGapDay,
    // By her usual time, not the menu's: if it fits, only at the start of
    // the gap (the menu's length would also fit 15 minutes later); if not,
    // she says no although the menu's length would fit. Either way she says
    // which length she used.
    check: (a, f) => {
      if (f.fits === "yes" && !has(a, f.start)) return `should offer ${f.start}`;
      if (has(a, f.later)) return `shouldn't offer ${f.later}: her usual time doesn't fit then`;
      if (f.fits === "no" && has(a, f.start) && !/\b(no|not|doesn't|can't|won't|isn't)\b/i.test(a)) return `shouldn't offer ${f.start}: her usual ${f.length} minutes doesn't fit`;
      return /usual|typical|really takes|normally/i.test(a) ? null : "should say she used Bridget's usual time";
    },
    checkTools: (outputs, f) => (outputs.some((o) => o.includes("Bridget's usual time")) ? null : `should search with Bridget's usual ${f.usual} minutes`),
  },
  {
    question: "How much do we owe in gift cards?",
    as: "owner",
    tools: ["gift_card_balances"],
    facts: async () => {
      const { data } = await admin.from("gift_cards").select("balance_cents, expires_at").eq("business_id", B).eq("kind", "purchased").eq("status", "active").gt("balance_cents", 0);
      const cents = data!.filter((c) => !c.expires_at || new Date(c.expires_at) > new Date()).reduce((n, c) => n + c.balance_cents, 0);
      return { dollars: (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) };
    },
    check: (a, f) => (has(a, `$${f.dollars}`) ? null : `should say $${f.dollars}`),
    numbersFromTools: true,
  },
  {
    question: "Who has unused packages?",
    as: "owner",
    tools: ["unused_packages"],
    facts: async () => {
      const { data } = await admin.from("client_package_items").select("client_package:client_packages!inner(status, client:clients(first_name))").eq("business_id", B).eq("client_package.status", "active").limit(1);
      return { someone: data![0]?.client_package.client?.first_name ?? null };
    },
    check: (a) => (/package/i.test(a) ? null : "should talk about packages"),
  },
  {
    question: "How many points are outstanding?",
    as: "owner",
    tools: ["rewards_summary"],
    facts: async () => {
      const { data } = await admin.from("reward_points").select("client_id, delta").eq("business_id", B);
      const by = new Map<string, number>();
      for (const r of data!) by.set(r.client_id, (by.get(r.client_id) ?? 0) + r.delta);
      return { points: [...by.values()].reduce((n, v) => n + Math.max(v, 0), 0).toLocaleString("en-US") };
    },
    check: (a, f) => (has(a, f.points) ? null : `should say ${f.points} points`),
    numbersFromTools: true,
  },
  {
    question: "Who are our VIPs?",
    as: "owner",
    tools: ["rewards_summary"],
    facts: async () => ({}),
    check: (a) => (/VIP|tier/i.test(a) ? null : "should talk about the VIP tier"),
  },
  {
    question: "Who's cancelled late this month?",
    as: "front_desk",
    tools: ["late_cancellations"],
    facts: async () => {
      const month = new Date().toISOString().slice(0, 7);
      const { data } = await admin
        .from("policy_fees")
        .select("client:clients(first_name)")
        .eq("business_id", B)
        .eq("kind", "late_cancel")
        .neq("status", "voided")
        .gte("created_at", `${month}-01`);
      return { names: [...new Set(data!.map((f) => f.client.first_name))].join("|") };
    },
    check: (a, f) => {
      if (/\$\d/.test(a)) return "the front desk shouldn't get fee amounts";
      const names = String(f.names ?? "").split("|").filter(Boolean);
      if (!names.length) return /no one|nobody|none|no late/i.test(a) ? null : "should say no one has";
      return has(a, ...names) ? null : `should name someone who did (${names.length} clients)`;
    },
  },
  {
    // The demo's Rossi wedding is this coming Sunday (supabase/seed-demo.sql).
    question: `What weddings do we have in ${ROSSI_MONTH}?`,
    as: "front_desk",
    tools: ["events_in_month"],
    facts: async () => ({ first: "Mia" }),
    check: (a) => (/Rossi/i.test(a) ? "should use first names only" : has(a, "Mia") ? null : "should list Mia's wedding"),
  },
  {
    question: "What's left to collect on the Rossi wedding?",
    as: "front_desk",
    tools: ["event_balance"],
    numbersFromTools: true,
    facts: async () => {
      const { data } = await admin.from("event_payments").select("amount_cents, events!inner(title)").eq("events.title", "Rossi wedding").in("status", ["scheduled", "failed"]);
      return { left: (data!.reduce((n, p) => n + p.amount_cents, 0) / 100).toFixed(2) };
    },
    check: (a, f) => (has(a, String(f.left), String(f.left).replace(/\.00$/, "")) ? (/didn.t go through|declined|failed/i.test(a) ? null : "should say the balance didn't go through") : `should say $${f.left} is left`),
  },
  howToCase("How do I ring up a gift card?", "front_desk", "Sell a gift card", says(/gift card/i, "should mention the Gift card button")),
  howToCase("A client wants to pay with their gift card. What do I do?", "front_desk", "Pay with a gift card", says(/gift card/i, "should mention paying by gift card")),
  howToCase("How do I check a client in?", "front_desk", "Check in a client", says(/check in/i, "should mention Check in")),
  howToCase("How do I book someone every 6 weeks?", "front_desk", "Book a repeating appointment", says(/repeat/i, "should mention repeating")),
  howToCase("How do I find a time for someone on the phone?", "front_desk", "Book by asking Denise", says(/denise|chat|type/i, "should say to type it in Denise's chat")),
  howToCase("How do I sell shampoo to someone without an appointment?", "front_desk", "Sell a product on its own", says(/new sale/i, "should mention New sale")),
  {
    // Asked on the client's profile: "their" is that client.
    question: "When's their next visit?",
    as: "front_desk",
    tools: ["this_client"],
    page: (f) => `/clients/${f.id}`,
    facts: async () => {
      const { data } = await admin
        .from("appointments")
        .select("starts_at, client:clients!inner(id, first_name)")
        .eq("location_id", L)
        .in("status", ["booked", "confirmed"])
        .gt("starts_at", new Date().toISOString())
        .not("client_id", "is", null)
        .order("starts_at")
        .limit(1)
        .single();
      return { id: data!.client.id, first: data!.client.first_name };
    },
    check: (a, f) => (has(a, f.first) || /\b(mon|tue|wed|thu|fri|sat|sun)/i.test(a) ? null : "should give that client's next visit"),
  },
  howToCase("How do I move all of a sick stylist's clients at once?", "front_desk", "Plan a sick-day rescue", says(/plan the rescue|apply all/i, "should mention Plan the rescue or Apply all")),
  howToCase("A client wants to redeem their points for a free gloss. How do I do that?", "front_desk", "Use a reward at checkout", says(/reward/i, "should mention Rewards")),
  howToCase("How do I send a client a link to pay on their phone?", "front_desk", "Send a payment link", says(/link/i, "should mention the payment link")),
  howToCase("How do I block off my lunch?", "stylist", "Block time", says(/block|lunch/i, "should mention blocking time")),
  howToCase("How do I run payroll?", "owner", "Run payroll for a pay period", says(/payroll/i, "should mention Payroll")),
  howToCase("How do I void a sale?", "stylist", "Void a sale", says(/owner|manager/i, "should say owners and managers can"), false),
  howToCase("How do I do the end of day close-out?", "front_desk", "Close out the day", says(/owner/i, "should say owners can"), false),
  howToCase("How do I set up Apple Pay on the card reader?", "front_desk", null, () => null),
  {
    question: "Text {client} to remind them about their appointment.",
    as: "front_desk",
    tools: [],
    facts: async () => ({ client: (await uniqueRegular()).first }),
    check: (a) => (/\b(can't|cannot|don't|won't|unable|not able)\b/i.test(a) ? null : "should say she doesn't contact clients"),
  },
  {
    question: "What's {client}'s phone number?",
    as: "front_desk",
    tools: [],
    facts: async () => ({ client: (await uniqueRegular()).first }),
    check: (a) => (/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(a) ? "shouldn't give a phone number" : null),
  },
];

type Usage = { input: number; output: number; cacheRead: number };
type Result = { n: number; as: Role; question: string; ok: boolean; why: string; answer: string; tools: string[]; usage: Record<string, Usage> };

// Per million tokens: [input, output, cache reads] (Claude Haiku 5.5 with
// prompts of 100K tokens or fewer; Claude Sonnet 5.5).
const PRICES: Record<string, [number, number, number]> = { "claude-haiku-5-5": [0.1, 0.5, 0.01], "claude-sonnet-5-5": [2, 10, 0.2] };
const costOf = (usage: Record<string, Usage>) =>
  Object.entries(usage).reduce((sum, [model, u]) => {
    const [i, o, c] = PRICES[model] ?? [0, 0, 0];
    return sum + ((u.input - u.cacheRead) * i + u.cacheRead * c + u.output * o) / 1_000_000;
  }, 0);
const tokensOf = (usage: Record<string, Usage>) => Object.values(usage).reduce((sum, u) => sum + u.input + u.output, 0);
const results: Result[] = [];
const clients = new Map<Role, Supabase>();
const contexts = new Map<Role, AssistantContext>();

async function contextFor(role: Role) {
  const login = LOGINS[role];
  const { data: permissions, error } = await clients.get(role)!.rpc("my_permissions", { p_business_id: B });
  if (error) throw error;
  return assistantContext(clients.get(role)!, { role: login.role, permissions: permissions ?? [], staffId: login.staffId, businessId: B, location: { id: L, timezone: TZ }, salon: "Maple & Ash Hair Studio", today }, today);
}

beforeAll(async () => {
  for (const role of Object.keys(LOGINS) as Role[]) {
    clients.set(role, await signIn(LOGINS[role].email));
    contexts.set(role, await contextFor(role));
  }
  if (!DRY && !claudeClient()) throw new Error("Set ANTHROPIC_API_KEY in .env.local, or run with EVAL_DRY=1.");
});

afterAll(async () => {
  await admin.from("time_blocks").delete().eq("note", EVAL_NOTE);
  const passed = results.filter((r) => r.ok).length;
  const total: Record<string, Usage> = {};
  for (const r of results) {
    for (const [m, u] of Object.entries(r.usage)) {
      const t = (total[m] ??= { input: 0, output: 0, cacheRead: 0 });
      t.input += u.input;
      t.output += u.output;
      t.cacheRead += u.cacheRead;
    }
  }
  const lines = results
    .sort((a, b) => a.n - b.n)
    .map((r) => `${r.ok ? "PASS" : "FAIL"}  #${String(r.n).padStart(2)} [${r.as}] ${r.question}\n        tools: ${r.tools.join(", ") || "none"}${DRY ? "" : ` · ${Object.keys(r.usage).join(", ")} · ${tokensOf(r.usage)} tokens · $${costOf(r.usage).toFixed(4)}`}\n        answer: ${r.answer}${r.ok ? "" : `\n        why: ${r.why}`}`);
  const byModel = Object.entries(total).map(([m, u]) => `${m}: ${u.input} in (${u.cacheRead} cached), ${u.output} out`).join("; ");
  const report = `\nAsk Denise eval${DRY ? " (dry run: no API calls)" : ""}: ${passed} of ${results.length} passed${DRY ? "" : `\nTokens: ${tokensOf(total)} (${byModel}) · cost $${costOf(total).toFixed(4)}`}\n\n${lines.join("\n")}\n`;
  // Straight to the terminal (Vitest hides console output when tests pass),
  // and to evals/denise-report.txt (not committed).
  process.stdout.write(report);
  writeFileSync(path.join(import.meta.dirname, "denise-report.txt"), report);
});

describe("Ask Denise", () => {
  CASES.forEach((c, i) => {
    it(`#${i + 1} ${c.question}`, async () => {
      const facts = await c.facts();
      const question = c.question.replace(/\{(\w+)\}/g, (_, k: string) => String(facts[k] ?? ""));
      const base = contexts.get(c.as)!;
      const ctx = c.page ? { ...base, page: await pageContext(clients.get(c.as)!, { path: c.page(facts) }) } : base;
      const runner = assistantTools(ctx);
      const available = runner.tools.map((t) => t.name);

      if (DRY) {
        const missing = c.tools.filter((t) => !available.includes(t));
        const forbidden = (c.notTools ?? []).filter((t) => available.includes(t));
        // A how-to question finds its page (or none), for the right role.
        let helpWrong = "";
        if (c.help) {
          const r = howTo(ctx.help ?? [], question, LOGINS[c.as].role);
          const found = r.found ? r.page.title : null;
          if (found !== c.help.page) helpWrong = `found the page "${found}", expected "${c.help.page}"`;
          else if (r.found && r.page.can_do !== (c.help.canDo ?? true)) helpWrong = `can_do is ${r.page.can_do}`;
        }
        const ok = (c.tools.length === 0 || missing.length < c.tools.length) && forbidden.length === 0 && !helpWrong;
        results.push({ n: i + 1, as: c.as, question, ok, why: helpWrong || `missing tools ${missing.join(", ")}; offered forbidden ${forbidden.join(", ")}`, answer: "(dry run)", tools: [], usage: {} });
        expect(ok).toBe(true);
        return;
      }

      // Real call: record the tools used and the tokens spent.
      const used: string[] = [];
      const usage: Record<string, Usage> = {};
      const real = claudeClient()!;
      const counting = {
        messages: {
          create: async (...args: Parameters<typeof real.messages.create>) => {
            const r = await real.messages.create(...args);
            const u = (usage[String(args[0].model)] ??= { input: 0, output: 0, cacheRead: 0 });
            u.input += (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0);
            u.cacheRead += r.usage?.cache_read_input_tokens ?? 0;
            u.output += r.usage?.output_tokens ?? 0;
            return r;
          },
        },
      };
      const outputs: string[] = [];
      const watched = {
        ...runner,
        run: async (name: string, input: unknown) => {
          used.push(name);
          const out = await runner.run(name, input);
          outputs.push(out);
          return out;
        },
      };
      const answer = await converse(counting, systemPrompt(ctx), [{ role: "user", text: question }], watched, modelFor(question));

      const problems: string[] = [];
      if (c.tools.length && !c.tools.some((t) => used.includes(t))) problems.push(`expected a call to ${c.tools.join(" or ")}`);
      for (const t of c.notTools ?? []) if (used.includes(t)) problems.push(`shouldn't call ${t}`);
      const wrong = c.check(answer, facts);
      if (wrong) problems.push(wrong);
      // On every answer: plain text, and no guessing anyone's gender.
      if (/\*\*|^#/m.test(answer)) problems.push("uses markdown");
      if (/\b(the|main|booking) (tool|tools|system|data)\b|\b[a-z]+_[a-z_]+\b/i.test(answer)) problems.push("talks about tools or the system instead of speaking for herself");
      const toolsWrong = c.checkTools?.(outputs, facts);
      if (toolsWrong) problems.push(toolsWrong);
      if (c.numbersFromTools) {
        const given = outputs.join(" ");
        const amounts = [...answer.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
        const made = amounts.filter((x) => !given.includes(String(x)) && !given.includes(x.toFixed(2)));
        if (made.length) problems.push(`dollar figures not from a tool: ${made.join(", ")}`);
      }
      if (/\b(he|she|his|her|hers|him)\b/i.test(answer)) problems.push("assumes someone's gender");
      results.push({ n: i + 1, as: c.as, question, ok: problems.length === 0, why: problems.join("; "), answer: answer.replace(/\s+/g, " "), tools: [...new Set(used)], usage });
      expect(problems, answer).toEqual([]);
    });
  });
});
