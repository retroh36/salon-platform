"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert, Badge, EmptyState, Section, textLinkClass } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { describeTimeOff, formatDay, formatDayAt } from "@/lib/schedule-format";
import { formatMinute, type LocalDate } from "@/lib/scheduling/time";
import { outPanelHref, visitsByDay } from "@/lib/time-off-requests";
import type { RequestsInbox, TimeOffRequest } from "@/lib/time-off-requests-load";
import { approveAndPlan, approveRequest, declineRequest } from "./actions";

const clients = (n: number) => `${n} client${n === 1 ? "" : "s"}`;

export function RequestsView({ inbox, today, timezone }: { inbox: RequestsInbox; today: LocalDate; timezone: string }) {
  const [declining, setDeclining] = useState<TimeOffRequest | null>(null);
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <Section title={`Waiting (${inbox.pending.length})`} titleId="requests-waiting">
        {inbox.pending.length === 0 ? (
          <EmptyState>No requests waiting.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-labelledby="requests-waiting">
            {inbox.pending.map((r) => (
              <PendingRequest key={r.id} request={r} noticeDays={inbox.noticeDays} timezone={timezone} onDecline={() => setDeclining(r)} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Decided in the last 30 days" titleId="requests-decided">
        {inbox.decided.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing decided lately.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-labelledby="requests-decided">
            {inbox.decided.map((r) => (
              <DecidedRequest key={r.id} request={r} today={today} />
            ))}
          </ul>
        )}
      </Section>
      {declining && <DeclineSheet key={declining.id} request={declining} onClose={() => setDeclining(null)} />}
    </div>
  );
}

function PendingRequest({ request: r, noticeDays, timezone, onDecline }: { request: TimeOffRequest; noticeDays: number; timezone: string; onDecline: () => void }) {
  const [approved, approve, approving] = useActionState(approveRequest.bind(null, r.id), undefined);
  const days = visitsByDay(r.visits);
  const plan = days.length ? outPanelHref(r.staffId, days[0].date, r) : null;
  const [planned, approvePlan, planning] = useActionState(approveAndPlan.bind(null, r.id, plan ?? ""), undefined);
  const error = approved?.message ?? planned?.message;
  return (
    <li className="rounded-lg border border-line bg-surface p-4" data-request={r.id}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-base font-semibold text-ink">{r.name}</p>
          <p className="text-sm text-ink">{describeTimeOff({ ...r, status: r.status })}</p>
          {r.note && <p className="mt-1 text-sm text-ink-muted">&ldquo;{r.note}&rdquo;</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.blackouts.length > 0 && <Badge tone="danger">Blackout{r.blackouts[0].label ? `: ${r.blackouts[0].label}` : ""}</Badge>}
          {r.shortNotice && <Badge tone="warning">Short notice (under {noticeDays} days)</Badge>}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-ink-muted">Clients booked</dt>
        <dd data-testid="request-clients">
          {days.length === 0
            ? "None"
            : days.map((d) => (
                <p key={d.date}>
                  {formatDay(d.date)}: {clients(d.visits.length)}
                  <span className="text-ink-muted"> · {d.visits.slice(0, 4).map((v) => `${v.client} ${formatMinute(v.start)}`).join(", ")}{d.visits.length > 4 ? "…" : ""}</span>
                </p>
              ))}
        </dd>
        <dt className="text-ink-muted">Also off then</dt>
        <dd data-testid="request-others">
          {r.othersOff.length === 0 ? "Nobody" : r.othersOff.map((o) => `${o.name}${o.status === "requested" ? " (asked)" : ""}`).join(", ")}
        </dd>
        <dt className="text-ink-muted">Asked</dt>
        <dd>{formatDayAt(r.askedAt, timezone)}</dd>
      </dl>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {plan ? (
          <form action={approvePlan}>
            <Button type="submit" variant="primary" disabled={planning || approving}>
              Approve and plan clients
            </Button>
          </form>
        ) : null}
        <form action={approve}>
          <Button type="submit" variant={plan ? "secondary" : "primary"} disabled={approving || planning}>
            Approve
          </Button>
        </form>
        <Button variant="secondary" onClick={onDecline}>
          Decline…
        </Button>
      </div>
    </li>
  );
}

function DecidedRequest({ request: r, today }: { request: TimeOffRequest; today: LocalDate }) {
  const days = visitsByDay(r.visits);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm" data-request={r.id}>
      <span className="min-w-36 font-medium text-ink">{r.name}</span>
      <span className="flex-1">
        {describeTimeOff({ ...r, status: r.status })}
        {r.declineReason && <span className="text-ink-muted"> · {r.declineReason}</span>}
        {r.decidedBy && <span className="text-ink-muted"> · {r.decidedBy}</span>}
      </span>
      <Badge tone={r.status === "approved" ? "success" : "neutral"}>{r.status === "approved" ? "Approved" : "Declined"}</Badge>
      {r.status === "approved" &&
        days
          .filter((d) => d.date >= today)
          .map((d) => (
            <Link key={d.date} href={outPanelHref(r.staffId, d.date, r)} className={textLinkClass}>
              Plan {formatDay(d.date)}&rsquo;s {clients(d.visits.length)}
            </Link>
          ))}
    </li>
  );
}

function DeclineSheet({ request: r, onClose }: { request: TimeOffRequest; onClose: () => void }) {
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof declineRequest>[1], form: FormData) => {
    const result = await declineRequest(r.id, prev, form);
    if (result?.ok) onClose();
    return result;
  }, undefined);
  return (
    <Sheet title={`Decline ${r.firstName}'s request`} onClose={onClose}>
      <form action={action} className="flex flex-col gap-4">
        <p className="text-sm text-ink">{describeTimeOff({ ...r, status: r.status })}</p>
        <label className={labelClass}>
          Why (they&rsquo;ll see this)
          <textarea name="reason" rows={3} maxLength={300} required className={fieldClass} placeholder="Two others are already off that week." />
        </label>
        {state?.message && <Alert>{state.message}</Alert>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            Decline request
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
