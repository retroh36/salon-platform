// Denise, streamed: questions for her, and the reports that trigger her
// (a visit running late, a stylist out, a cancellation). She sends what
// she's doing as she works, her answer word by word, then her reply and
// her view of the day, one JSON object per line (DeniseEvent). She always
// replies: if something fails, she says so and the error is logged.

import { revalidatePath } from "next/cache";
import { answer, toolStatus } from "@/lib/denise/assistant";
import { assistantContext } from "@/lib/denise/context";
import { claudeFor, deniseDay } from "@/lib/denise/day-state";
import { ERROR_REPLY } from "@/lib/denise/respond";
import { askerOf, deniseSession, type DeniseSession } from "@/lib/denise/session";
import { replyToCallOut, replyToCancel, replyToLate } from "@/lib/denise/triggers";
import type { DeniseEvent, DeniseRequest } from "@/lib/denise/types";
import { DailyLimitReached } from "@/lib/denise/usage";
import { isUuid } from "@/lib/ids";
import { LATE_MINUTES, reportCallOut, reportRunningLate } from "@/lib/scheduling/disruptions";
import { startOfLocalDay } from "@/lib/scheduling/load";
import { isLocalDate } from "@/lib/scheduling/time";

const NOT_CONNECTED =
  "I'm not connected yet, so I can't answer questions. Once I am, ask me things like “Who's free for a color at 3?” In the meantime I'm still watching the calendar for clashes.";
const LIMIT_REACHED = "I've used up today's thinking for the salon, so I'll be back for questions tomorrow. I'm still watching the calendar for clashes in the meantime.";

const REPORT_ERRORS = {
  forbidden: "Only the front desk, managers and owners, or the stylist on this visit, can report that.",
  over: "That visit is already over, so there's nothing for me to change.",
  invalid: "Choose how many minutes.",
};

type Send = (event: DeniseEvent) => void;
const reply = (text: string, kind: "fixes" | "nothing" | "stuck" | "error"): DeniseEvent => ({ t: "done", reply: { text, kind } });

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as DeniseRequest | null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const s = await deniseSession();
        if (!s) send(reply("Sign in again.", "error"));
        else if (!body || !isLocalDate(body.date)) send(reply("I didn't catch that. Try again.", "error"));
        else await run(s, body, send);
      } catch (error) {
        if (error instanceof DailyLimitReached) send(reply(LIMIT_REACHED, "nothing"));
        else {
          // Logged without request details (no client data in logs).
          console.error("Denise:", error instanceof Error ? error.message : error);
          send({ t: "done", reply: ERROR_REPLY });
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

async function staffName(s: DeniseSession, staffId: string) {
  const { data } = await s.supabase.from("staff").select("first_name").eq("id", staffId).maybeSingle();
  return data?.first_name ?? "this stylist";
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
      const client = claudeFor(s.me.business_id, "ask_denise");
      if (!client) return send(reply(NOT_CONNECTED, "nothing"));
      status("Reading your question…");
      const context = await assistantContext(
        s.supabase,
        { role: s.me.role, staffId: s.me.id, businessId: s.me.business_id, location: s.viewer.location, salon: s.viewer.salon, today: s.today },
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
      return send({ t: "done", reply: { text: result.text, kind: "fixes" }, suggestions: result.suggestions });
    }
  }
}
