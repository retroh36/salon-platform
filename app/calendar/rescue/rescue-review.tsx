"use client";

// The sick-day rescue screen: mark the stylist out (all day or from a
// time), then every client's line with where they go (any line can be
// changed), Apply all in one go, and afterwards each client's message,
// sent from here, with Undo all.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge, EmptyState, Section, textLinkClass } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { useUnsavedChanges } from "@/components/unsaved";
import { smsCounterText } from "@/lib/messaging/templates";
import { clashingRows, movesOf, type RescueRow } from "@/lib/rescue";
import { applyRescue, markOut, sendRescueMessage, undoRescue, type RescueMessage } from "./actions";

type Message = RescueMessage & { clientName: string };

export function RescueReview({
  staffId,
  firstName,
  date,
  today,
  leaves,
  out,
  rows,
  applied,
  messages,
  freeText,
}: {
  staffId: string;
  firstName: string;
  date: string;
  today: string;
  leaves: string | null;
  out: { text: string } | null;
  rows: RescueRow[];
  applied: { actionId: string; by: string | null } | null;
  messages: Message[];
  freeText: boolean;
}) {
  if (!out) return <MarkOut staffId={staffId} firstName={firstName} date={date} today={today} leaves={leaves} />;
  if (applied) return <Done staffId={staffId} firstName={firstName} date={date} actionId={applied.actionId} by={applied.by} messages={messages} freeText={freeText} />;
  return <Plan staffId={staffId} firstName={firstName} date={date} rows={rows} />;
}

function MarkOut({ staffId, firstName, date, today, leaves }: { staffId: string; firstName: string; date: string; today: string; leaves: string | null }) {
  const router = useRouter();
  const [when, setWhen] = useState<"all" | "from">(leaves ? "from" : "all");
  const [from, setFrom] = useState(leaves ?? "13:00");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await markOut(staffId, date, when === "all" ? null : from);
      if (r.ok) router.refresh();
      else setMessage(r.message);
    });
  }

  return (
    <form onSubmit={submit} aria-label={`Mark ${firstName} out`} className="flex max-w-lg flex-col gap-4">
      <p className="text-sm text-ink-muted">
        This adds approved time off for {firstName}{date === today ? " from the time you choose" : ""}, so nothing else is booked with them. Then you&apos;ll see where each client can go.
      </p>
      <Segmented
        label="Out"
        value={when}
        onChange={(v) => setWhen(v as "all" | "from")}
        options={[
          { value: "all", label: "All day" },
          { value: "from", label: "From a time" },
        ]}
      />
      {when === "from" && (
        <label className={labelClass}>
          Leaves at
          <input type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value)} className={`${fieldClass} w-40`} required />
        </label>
      )}
      {message && <Alert>{message}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Marking out…" : `Mark ${firstName} out`}
        </Button>
        <Link href={`/calendar?date=${date}`} className={textLinkClass}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Plan({ staffId, firstName, date, rows }: { staffId: string; firstName: string; date: string; rows: RescueRow[] }) {
  const router = useRouter();
  const [choices, setChoices] = useState(() => rows.map((r) => r.choice));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = choices.some((c, i) => c !== rows[i].choice);
  useUnsavedChanges(changed);
  const clashes = useMemo(() => new Set(clashingRows(rows, choices)), [rows, choices]);
  const moves = movesOf(rows, choices);
  const moving = new Set(moves.map((m) => m.appointmentId)).size;

  if (!rows.length) return <EmptyState title={`No clients to move`}>{firstName} has nobody booked then.</EmptyState>;

  function apply() {
    setMessage(null);
    start(async () => {
      const r = await applyRescue(
        staffId,
        date,
        moves.map((m) => ({ appointmentId: m.appointmentId, itemId: m.itemId, staffId: m.staffId, resourceId: m.resourceId, start: m.start })),
      );
      if (r.ok) router.refresh();
      else setMessage(r.message);
    });
  }

  return (
    <>
      <Section title={`${firstName}'s clients`} count={rows.length} description="Denise's plan: the same time with someone at the same level where she can, then a little later, then another day.">
        <ol className="flex flex-col gap-3" aria-label="Rescue plan">
          {rows.map((row, i) => {
            const choice = row.choices[choices[i]];
            return (
              <li key={row.appointmentId} className="rounded-lg border border-line bg-surface p-4" data-testid="rescue-row">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {row.clientId ? (
                        <Link href={`/clients/${row.clientId}`} className="hover:underline">
                          {row.clientName}
                        </Link>
                      ) : (
                        row.clientName
                      )}
                    </p>
                    <p className="text-13 text-ink-muted">
                      {row.when} · {row.services}
                    </p>
                  </div>
                  {clashes.has(i) ? (
                    <Badge tone="danger">Clashes with a line above</Badge>
                  ) : choice.kind === "leave" ? (
                    <Badge tone="warning">Call to rebook</Badge>
                  ) : (
                    <Badge tone={choice.kind === "cover" ? "success" : "info"}>{choice.kind === "cover" ? "Same time" : choice.kind === "shift" ? "Later that day" : "Another day"}</Badge>
                  )}
                </div>
                {row.note && <p className="mt-2 text-13 text-ink-muted">{row.note}</p>}
                {row.choices.length > 1 && (
                  <label className={`${labelClass} mt-3`}>
                    Where they go
                    <select
                      className={selectClass}
                      value={choices[i]}
                      onChange={(e) => setChoices((c) => c.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                    >
                      {row.choices.map((c, k) => (
                        <option key={k} value={k}>
                          {c.label}
                          {c.detail ? ` (${c.detail})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {choice.detail && <p className="mt-1.5 text-13 text-ink-muted">{choice.detail}</p>}
              </li>
            );
          })}
        </ol>
      </Section>
      {message && <Alert className="mb-4">{message}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={apply} disabled={pending || clashes.size > 0 || moving === 0}>
          {pending ? "Applying…" : moving ? `Apply all (${moving} ${moving === 1 ? "client" : "clients"})` : "Apply all"}
        </Button>
        <p className="text-13 text-ink-muted">
          {clashes.size > 0 ? "Change the lines that clash first." : "Nothing moves until you apply. You can undo it after."}
        </p>
      </div>
    </>
  );
}

function Done({ staffId, firstName, date, actionId, by, messages, freeText }: { staffId: string; firstName: string; date: string; actionId: string; by: string | null; messages: Message[]; freeText: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const unsent = messages.filter((m) => !m.sent && m.channel);

  function undo() {
    start(async () => {
      const r = await undoRescue(actionId);
      if (r.ok) router.refresh();
      else setNote({ tone: "error", text: r.message });
    });
  }

  return (
    <>
      <Alert tone="success" className="mb-6">
        <p>
          The plan is applied{by ? ` (by ${by})` : ""}. The stylists taking on {firstName}&apos;s clients have a notice on My day.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link href={`/calendar?date=${date}`} className={textLinkClass}>
            See the calendar
          </Link>
          <Button size="sm" onClick={undo} disabled={pending}>
            Undo all
          </Button>
        </div>
      </Alert>
      {note && <Alert tone={note.tone === "error" ? "error" : "success"} className="mb-4">{note.text}</Alert>}
      <Section
        title="Messages to clients"
        count={messages.length}
        description="From our templates, filled in with each visit as it is now. Change the words before sending if you need to."
        actions={unsent.length > 1 ? <SendAll staffId={staffId} messages={unsent} onDone={() => router.refresh()} /> : null}
      >
        {messages.length === 0 ? (
          <EmptyState art={false}>No one to message.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageRow key={m.appointmentId} staffId={staffId} message={m} freeText={freeText} onSent={() => router.refresh()} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function MessageRow({ staffId, message: m, freeText, onSent }: { staffId: string; message: Message; freeText: boolean; onSent: () => void }) {
  const [body, setBody] = useState(m.body);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const edited = body.trim() !== m.body.trim();
  const counter = m.channel === "sms" ? smsCounterText(body) : null;

  function send() {
    if (!m.channel) return;
    start(async () => {
      const r = await sendRescueMessage({ appointmentId: m.appointmentId, staffId, template: m.template, channel: m.channel!, edited: edited ? body : null, subject: m.subject });
      setResult({ ok: r.ok, text: r.message });
      if (r.ok) onSent();
    });
  }

  return (
    <li className="rounded-lg border border-line bg-surface p-4" data-testid="rescue-message">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{m.clientName}</p>
        {m.sent ? <Badge tone="success">Sent</Badge> : m.channel ? <Badge>{m.channel === "sms" ? "Text" : "Email"}</Badge> : <Badge tone="warning">No messages: call</Badge>}
      </div>
      {m.sent || !m.channel ? (
        <p className="text-sm whitespace-pre-line text-ink-muted">{m.body}</p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`msg-${m.appointmentId}`}>
            Message to {m.clientName}
          </label>
          <textarea
            id={`msg-${m.appointmentId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            readOnly={!freeText}
            rows={3}
            className={`${fieldClass} h-auto py-2`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={send} disabled={pending || !body.trim()}>
              {pending ? "Sending…" : "Send"}
            </Button>
            {counter && <span className={`text-xs ${counter.warn ? "text-warning" : "text-ink-subtle"}`}>{counter.text}</span>}
            {!freeText && <span className="text-xs text-ink-subtle">Your role sends the template as it is.</span>}
          </div>
        </>
      )}
      {result && !result.ok && <Alert className="mt-2">{result.text}</Alert>}
    </li>
  );
}

function SendAll({ staffId, messages, onDone }: { staffId: string; messages: Message[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          for (const m of messages) await sendRescueMessage({ appointmentId: m.appointmentId, staffId, template: m.template, channel: m.channel!, edited: null, subject: m.subject });
          onDone();
        })
      }
    >
      {pending ? "Sending…" : `Send all (${messages.length})`}
    </Button>
  );
}
