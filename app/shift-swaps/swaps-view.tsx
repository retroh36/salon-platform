"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge, EmptyState, Section } from "@/components/ui/page";
import { formatDay, formatIntervals } from "@/lib/schedule-format";
import type { LocalDate } from "@/lib/scheduling/time";
import { cantTake, offerableDays, SWAP_STATUS } from "@/lib/shift-swaps";
import type { ShiftSwap, SwapPerson } from "@/lib/shift-swaps-load";
import { answerSwap, askForSwap, cancelSwap, type SwapState } from "./actions";

const dayLabel = (date: LocalDate, hours: { start: number; end: number }[]) => `${formatDay(date)} · ${formatIntervals(hours)}`;

// "Sam gives Jordan Wed, Nov 4 (9am–5pm), and takes Jordan's Thu, Nov 5 (12pm–8pm)."
export function swapText(s: ShiftSwap, meId: string): string {
  const from = s.fromId === meId ? "You" : s.fromName.split(" ")[0];
  const to = s.toId === meId ? "you" : s.toName.split(" ")[0];
  const gives = `${from} ${s.fromId === meId ? "give" : "gives"} ${to} ${formatDay(s.giveDate)} (${formatIntervals(s.giveShifts)})`;
  if (!s.takeDate) return `${gives}.`;
  const theirs = s.toId === meId ? "your" : `${to}'s`;
  return `${gives}, and ${s.fromId === meId ? "take" : "takes"} ${theirs} ${formatDay(s.takeDate)} (${formatIntervals(s.takeShifts!)}).`;
}

export function SwapsView({ me, partners, incoming, mine, today }: { me: SwapPerson; partners: SwapPerson[]; incoming: ShiftSwap[]; mine: ShiftSwap[]; today: LocalDate }) {
  const [notice, setNotice] = useState<SwapState>(undefined);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<SwapState>) => start(async () => setNotice(await action()));
  return (
    <div className="flex max-w-xl flex-col gap-8">
      {notice?.message && <Alert tone={notice.ok ? "success" : "error"}>{notice.message}</Alert>}
      {incoming.length > 0 && (
        <Section title={`Asked of you (${incoming.length})`} titleId="swaps-incoming">
          <ul className="flex flex-col gap-3" aria-labelledby="swaps-incoming">
            {incoming.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4" data-swap={s.id}>
                <p className="text-sm text-ink">{swapText(s, me.id)}</p>
                {s.note && <p className="mt-1 text-sm text-ink-muted">&ldquo;{s.note}&rdquo;</p>}
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" disabled={pending} onClick={() => run(() => answerSwap(s.id, true))}>
                    Accept
                  </Button>
                  <Button variant="secondary" disabled={pending} onClick={() => run(() => answerSwap(s.id, false))}>
                    Say no
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Ask for a swap" titleId="swaps-ask">
        {partners.length === 0 ? (
          <EmptyState>Nobody else here has your role, so there&rsquo;s no one to swap with. Ask a manager to change your hours.</EmptyState>
        ) : (
          <AskForm me={me} partners={partners} today={today} />
        )}
      </Section>
      <Section title="Your swaps" titleId="swaps-mine">
        {mine.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-labelledby="swaps-mine">
            {mine.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm" data-swap={s.id}>
                <span className="min-w-0 flex-1">
                  {swapText(s, me.id)}
                  {s.declineReason && <span className="block text-13 text-ink-muted">Declined: {s.declineReason}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={SWAP_STATUS[s.status].tone}>{SWAP_STATUS[s.status].label}</Badge>
                  {s.fromId === me.id && (s.status === "asked" || s.status === "accepted") && (
                    <Button variant="quiet" size="sm" disabled={pending} onClick={() => run(() => cancelSwap(s.id))}>
                      Cancel
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function AskForm({ me, partners, today }: { me: SwapPerson; partners: SwapPerson[]; today: LocalDate }) {
  const [state, action, pending] = useActionState(askForSwap, undefined);
  const [toId, setToId] = useState(partners[0].id);
  const mine = offerableDays(Object.entries(me.days).map(([date, d]) => ({ date, hours: d.hours })), today);
  const [give, setGive] = useState(mine[0]?.date ?? "");
  const [take, setTake] = useState("");
  const partner = partners.find((p) => p.id === toId)!;
  const theirs = offerableDays(Object.entries(partner.days).map(([date, d]) => ({ date, hours: d.hours })), today);
  // Checked here first so it's clear before asking; the database checks again.
  const problem =
    (give && cantTake(partner.firstName, partner.days[give], me.days[give].hours, formatDay(give))) ||
    (take && cantTake(null, me.days[take], partner.days[take].hours, formatDay(take))) ||
    null;
  if (!mine.length) return <p className="text-sm text-ink-muted">You have no shifts in the next few weeks to offer.</p>;
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4" aria-label="Ask for a swap">
      <label className={labelClass}>
        Coworker
        <select name="to_staff_id" value={toId} onChange={(e) => (setToId(e.target.value), setTake(""))} className={selectClass}>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Your day to give
        <select name="give_date" value={give} onChange={(e) => setGive(e.target.value)} className={selectClass}>
          {mine.map((d) => (
            <option key={d.date} value={d.date}>
              {dayLabel(d.date, d.hours)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Their day you take (optional)
        <select name="take_date" value={take} onChange={(e) => setTake(e.target.value)} className={selectClass}>
          <option value="">None, just give my day</option>
          {theirs.map((d) => (
            <option key={d.date} value={d.date}>
              {dayLabel(d.date, d.hours)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Note (optional)
        <input name="note" maxLength={300} className={fieldClass} placeholder="Doctor's appointment" />
      </label>
      {problem && <Alert tone="warning">{problem}</Alert>}
      {state?.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <div>
        <Button type="submit" variant="primary" disabled={pending || Boolean(problem)}>
          Ask {partner.firstName}
        </Button>
      </div>
    </form>
  );
}
