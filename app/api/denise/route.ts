// Denise, streamed: questions for her, and the reports that trigger her
// (a visit running late, a stylist out, a cancellation). She sends what
// she's doing as she works, her answer word by word, then her reply and
// her view of the day, one JSON object per line (DeniseEvent). She always
// replies: if something fails, the error is logged with what she was doing
// (./lib/denise/errors.ts) and she says what staff can do: wait for
// tomorrow at the daily limit, try again in a minute when the API is busy,
// or that it's been logged, with a reference that matches the log line.
// If the browser goes (the page closed or moved on), she stops at her next
// step: nothing is written after that, and it isn't logged as an error.

import { revalidatePath } from "next/cache";
import { canBook } from "@/lib/appointments";
import { answer, toolStatus } from "@/lib/denise/assistant";
import { readCallOut } from "@/lib/denise/call-out";
import { assistantContext } from "@/lib/denise/context";
import { claudeFor, deniseDay } from "@/lib/denise/day-state";
import { DEMO_DENISE_PER_10_MIN, DEMO_LIMIT_TEXT, DEMO_SLOW_DOWN, isDemo } from "@/lib/demo";
import { FAILURE_TEXT, failureRef, logDeniseError } from "@/lib/denise/errors";
import { askerOf, deniseSession, type DeniseSession } from "@/lib/denise/session";
import { replyToCallOut, replyToCancel, replyToLate } from "@/lib/denise/triggers";
import type { DeniseEvent, DeniseRequest } from "@/lib/denise/types";
import { isUuid } from "@/lib/ids";
import { LATE_MINUTES, reportCallOut, reportRunningLate } from "@/lib/scheduling/disruptions";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { formatMinute, isLocalDate, minuteToTime } from "@/lib/scheduling/time";
import { requestInfo, withinLimits } from "@/lib/online-booking/security";
import { createAdminClient } from "@/lib/supabase/admin";

const NOT_CONNECTED =
  "I'm not connected yet, so I can't answer questions. Once I am, ask me things like “Who's free for a color at 3?” In the meantime I'm still watching the calendar for clashes.";

const REPORT_ERRORS = {
  forbidden: "Only the front desk, managers and owners, or the stylist on this visit, can report that.",
  over: "That visit is already over, so there's nothing for me to change.",
  invalid: "Choose how many minutes.",
};

type Send = (event: DeniseEvent) => void;

// Thrown by send once the browser has gone, to stop her work.
class Gone extends Error {}

const reply = (text: string, kind: "fixes" | "nothing" | "stuck" | "error"): DeniseEvent => ({ t: "done", reply: { text, kind } });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as DeniseRequest | null;
  const encoder = new TextEncoder();
  let gone = request.signal.aborted;
  const leave = () => {
    gone = true;
  };
  request.signal.addEventListener("abort", leave, { once: true });
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (event) => {
        if (gone) throw new Gone();
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      let businessId: string | undefined;
      try {
        const s = await deniseSession();
        businessId = s?.me.business_id;
        if (!s) send(reply("Sign in again.", "error"));
        else if (!body || !isLocalDate(body.date)) send(reply("I didn't catch that. Try again.", "error"));
        else if (isDemo() && !(await withinDemoLimit())) send(reply(DEMO_SLOW_DOWN, "nothing"));
        else await run(s, body, send);
      } catch (error) {
        if (!(error instanceof Gone)) {
          // Logged with the error's details and what she was doing, never the
          // question or client data.
          const ref = failureRef();
          const kind = logDeniseError(error, { where: typeof body?.action === "string" ? body.action : "unknown", businessId, ref });
          if (!gone) {
            if (kind === "limit") send(reply(isDemo() ? DEMO_LIMIT_TEXT : FAILURE_TEXT.limit, "nothing"));
            else if (kind === "busy") send(reply(FAILURE_TEXT.busy, "error"));
            else send(reply(`${FAILURE_TEXT[kind]} (Ref ${ref})`, "error"));
          }
        }
      } finally {
        request.signal.removeEventListener("abort", leave);
      }
      if (!gone) controller.close();
    },
    cancel: leave,
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

// In the demo, testers share the same few logins, so the limit is per
// connection.
async function withinDemoLimit(): Promise<boolean> {
  const { ipHash } = await requestInfo();
  return withinLimits(createAdminClient(), [{ key: `denise:${ipHash}`, limit: DEMO_DENISE_PER_10_MIN, windowSeconds: 600 }]);
}

async function staffName(s: DeniseSession, staffId: string) {
  const { data } = await s.supabase.from("staff").select("first_name").eq("id", staffId).maybeSingle();
  return data?.first_name ?? "this stylist";
}

// A question saying a stylist is out: a link to plan the rescue (front of
// house), or how to mark yourself out.
async function callOutIn(s: DeniseSession, text: string, date: string) {
  const { data: team } = await s.supabase.from("staff").select("id, first_name, staff_services(service_id)").eq("location_id", s.viewer.location.id).eq("is_active", true);
  const read = readCallOut(text, (team ?? []).filter((t) => t.staff_services.length > 0).map((t) => ({ id: t.id, firstName: t.first_name })));
  if (!read) return null;
  if (!canBook(s.me.role)) {
    const text = read.staffId === s.me.id ? "Mark yourself out from the ⋯ on your column on the calendar, and I'll find new places for your clients." : `The front desk can plan where ${read.firstName}'s clients go.`;
    return { t: "done" as const, reply: { text, kind: "nothing" as const } };
  }
  const from = read.from === null ? "" : `&from=${minuteToTime(read.from)}`;
  const when = read.from === null ? "" : ` from ${formatMinute(read.from)}`;
  return {
    t: "done" as const,
    reply: { text: `Sorry to hear ${read.firstName} is out${when}. I'll plan where each of ${read.firstName}'s clients goes, and you check it before anything moves.`, kind: "fixes" as const },
    links: [{ path: `/calendar/rescue?staff=${read.staffId}&date=${date}${from}`, label: "Open sick-day rescue" }],
  };
}

async function run(s: DeniseSession, body: DeniseRequest, send: Send) {
  const status = (text: string) => send({ t: "status", text });
  const where = { supabase: s.supabase, location: s.viewer.location, today: s.today };
  const look = () => deniseDay(askerOf(s), body.date, { onStep: status });

  switch (body.action) {
    case "report_out": {
      if (!isUuid(body.staffId) || body.date < s.today) return send(reply("That day is over, so there's no one to move.", "nothing"));
      const name = await staffName(s, body.staffId);
      status(`Marking ${name} out…`);
      const isToday = body.date === s.today;
      const result = await reportCallOut(s.supabase, body.staffId, isToday ? new Date() : startOfLocalDay(body.date, s.viewer.location.timezone));
      if (!result.ok) return send(reply(result.error === "forbidden" ? "Only the front desk, managers and owners can mark someone else out." : REPORT_ERRORS[result.error], "error"));
      revalidatePath("/calendar", "layout");
      status(`Looking at ${name}'s clients${isToday ? " for the rest of today" : ""}…`);
      const state = await look();
      return send({ t: "done", reply: await replyToCallOut(where, body.staffId, body.date, result.id, state), state });
    }
    case "report_late": {
      if (!isUuid(body.itemId) || !LATE_MINUTES.includes(body.minutes)) return send(reply(REPORT_ERRORS.invalid, "error"));
      if (body.date < s.today) return send(reply(REPORT_ERRORS.over, "nothing"));
      status("Noting how late it's running…");
      const result = await reportRunningLate(s.supabase, body.itemId, body.minutes);
      if (!result.ok) return send(reply(REPORT_ERRORS[result.error], result.error === "over" ? "nothing" : "error"));
      revalidatePath("/calendar", "layout");
      status("Checking what that pushes into…");
      const state = await look();
      return send({ t: "done", reply: await replyToLate(where, body.itemId, body.minutes, body.date, result.id, state), state });
    }
    case "canceled": {
      if (!isUuid(body.appointmentId)) return send(reply("I can't find that booking any more.", "error"));
      status("Looking at the time that opened up…");
      const state = await look();
      status("Checking the waitlist…");
      const said = await replyToCancel(where, body.appointmentId, state);
      return send({ t: "done", reply: said ?? { text: "That's canceled. Nothing else changes.", kind: "nothing" }, state });
    }
    case "ask": {
      // "Nola called out", "Gil has to leave at 1": the sick-day rescue,
      // read by our code (no Claude needed).
      const last = [...(Array.isArray(body.history) ? body.history : [])].reverse().find((m) => m.role === "user");
      const out = last ? await callOutIn(s, String(last.text), isLocalDate(body.date) && body.date > s.today ? body.date : s.today) : null;
      if (out) return send(out);
      const client = claudeFor(s.me.business_id, "ask_denise");
      if (!client) return send(reply(NOT_CONNECTED, "nothing"));
      status("Reading your question…");
      const context = await assistantContext(
        s.supabase,
        { role: s.me.role, permissions: s.me.permissions, staffId: s.me.id, bookStaffId: s.me.assists_staff_id, businessId: s.me.business_id, location: s.viewer.location, salon: s.viewer.salon, today: s.today },
        body.date,
      );
      // Text only, starting with the staff member's question.
      const turns = (Array.isArray(body.history) ? body.history : [])
        .slice(-12)
        .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: String(m.text).slice(0, 1000) }));
      while (turns.length && turns[0].role !== "user") turns.shift();
      if (!turns.length) return send(reply("What would you like to know?", "nothing"));
      const result = await answer(client, context, turns, {
        onText: (text) => send({ t: "text", text }),
        onDiscard: () => send({ t: "discard" }),
        onTool: (name, input) => status(toolStatus(name, input, context)),
      });
      return send({ t: "done", reply: { text: result.text, kind: "fixes" }, suggestions: result.suggestions, links: result.links });
    }
  }
}
