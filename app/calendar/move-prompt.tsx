"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import type { Moved } from "@/lib/move-notices";
import { reach } from "@/lib/reach";
import { movedMessages, sendMovedMessage, type MovedMessages } from "./moved-actions";

// After staff move a visit (a drag, Edit booking, Move to another day):
// "Let Maria know about the new time?", the message as it would go, and
// Send / Don't send. The move itself tells the client nothing; only Send
// here does (send_client_message, logged with who sent it). The salon's
// setting (Settings → Messages) only decides which button comes first.
// A client who takes no messages shows "No messages: call" instead.
// "Don't ask again today" stops the question on this device for the rest
// of the salon's day; the clients moved then aren't told.

const offKey = (staffId: string) => `maestra:move-ask-off:${staffId}`;

export function askedOffToday(staffId: string, today: string): boolean {
  try {
    return window.localStorage.getItem(offKey(staffId)) === today;
  } catch {
    return false;
  }
}

function stopAskingToday(staffId: string, today: string) {
  try {
    window.localStorage.setItem(offKey(staffId), today);
  } catch {
    // Private windows: it asks again next time.
  }
}

const names = (list: { firstName: string }[]) =>
  list.length === 1 ? list[0].firstName : `${list.slice(0, -1).map((m) => m.firstName).join(", ")} and ${list[list.length - 1].firstName}`;

export function MovePrompt({ moved, staffId, today, onDone }: { moved: Moved; staffId: string; today: string; onDone: (message: string | null) => void }) {
  const [loaded, setLoaded] = useState<MovedMessages | "failed" | null>(null);
  const [offToday, setOffToday] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, start] = useTransition();

  useEffect(() => {
    let live = true;
    reach(movedMessages(moved.appointmentIds, moved.at)).then((r) => live && setLoaded("messages" in r ? r : "failed"));
    return () => {
      live = false;
    };
  }, [moved]);

  // Nobody left to tell, or asked not to today: say who hasn't been told.
  const off = loaded && loaded !== "failed" ? askedOffToday(staffId, today) : false;
  useEffect(() => {
    if (!loaded || loaded === "failed") return;
    const unsent = loaded.messages.filter((m) => !m.sent);
    if (!unsent.length) onDone(null);
    else if (off) onDone(`${names(unsent)} ${unsent.length === 1 ? "hasn't" : "haven't"} been told about the change.`);
  }, [loaded, off, onDone]);

  if (!loaded || off) return null;
  if (loaded === "failed") {
    return (
      <Alert>
        The message didn&rsquo;t load, so the client hasn&rsquo;t been told. Use Message client in booking details.{" "}
        <button type="button" className="font-semibold" onClick={() => onDone(null)}>
          Close
        </button>
      </Alert>
    );
  }
  const list = loaded.messages.filter((m) => !m.sent);
  if (!list.length) return null;
  const sendable = list.filter((m) => m.channel);

  function finish(send: boolean) {
    if (offToday) stopAskingToday(staffId, today);
    if (!send) return onDone(null);
    start(async () => {
      const failed: string[] = [];
      for (const m of sendable) {
        const r = await reach(sendMovedMessage({ appointmentId: m.appointmentId, channel: m.channel!, edited: null, subject: m.subject })).catch(() => ({ ok: false, message: "" }));
        if (!r.ok) failed.push(r.message || `${m.firstName}'s message didn't send.`);
      }
      if (failed.length) return setProblem(failed.join(" "));
      onDone(`Sent to ${names(sendable)}.`);
    });
  }

  const sendButton = (
    <Button key="send" variant={loaded.askDefault === "send" ? "primary" : "secondary"} size="sm" disabled={sending} onClick={() => finish(true)}>
      {sending ? "Sending…" : "Send"}
    </Button>
  );
  const skipButton = (
    <Button key="skip" variant={loaded.askDefault === "skip" ? "primary" : "secondary"} size="sm" disabled={sending} onClick={() => finish(false)}>
      Don&rsquo;t send
    </Button>
  );

  return (
    <section aria-labelledby="move-prompt-title" className="flex animate-fade-in flex-col gap-3 rounded-lg border border-line bg-surface p-3" data-testid="move-prompt">
      <h3 id="move-prompt-title" className="text-sm font-semibold text-ink">
        {list.length === 1 ? `Let ${list[0].firstName} know about the new time?` : `Let ${list.length} clients know about the new times?`}
      </h3>
      <ul className="flex flex-col gap-2">
        {list.map((m) => (
          <li key={m.appointmentId} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {list.length > 1 && <span className="text-13 font-medium text-ink">{m.clientName}</span>}
              {m.channel ? <Badge>{m.channel === "sms" ? "Text" : "Email"}</Badge> : <Badge tone="warning">No messages: call</Badge>}
            </div>
            {m.channel ? (
              <p className="rounded-md bg-sunken px-3 py-2 text-13 whitespace-pre-line text-ink-muted" data-testid="move-preview">
                {m.body}
              </p>
            ) : (
              <p className="text-13 text-ink-muted">
                {m.clientName} doesn&rsquo;t take messages about visits{m.phone ? `: call ${m.phone}` : ""}.
              </p>
            )}
          </li>
        ))}
      </ul>
      {problem && <Alert>{problem}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {sendable.length ? (loaded.askDefault === "send" ? [sendButton, skipButton] : [skipButton, sendButton]) : (
          <Button size="sm" onClick={() => finish(false)}>
            Done
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-13 text-ink-muted">
          <input type="checkbox" className={checkboxClass} checked={offToday} onChange={(e) => setOffToday(e.target.checked)} />
          Don&rsquo;t ask again today
        </label>
      </div>
    </section>
  );
}
