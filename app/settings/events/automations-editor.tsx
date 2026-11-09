"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/page";
import { automationProblem, EVENT_ACTIONS, EVENT_TRIGGERS, MESSAGE_FIELDS, whenText, type EventAction, type EventAutomation, type EventTrigger } from "@/lib/events/automations";
import type { EventStage } from "@/lib/events/stages";
import { deleteEventAutomation, saveEventAutomation, type Result } from "./actions";

const BLANK: EventAutomation = { id: "", name: "", trigger: "inquiry_received", daysBefore: null, waitDays: 0, action: "task", subject: null, body: null, task: null, stageId: null, enabled: true, approved: false };

export function EventAutomations({ automations, stages, isOwner }: { automations: EventAutomation[]; stages: EventStage[]; isOwner: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {automations.length > 0 && (
        <ul className="-mt-3 divide-y divide-line" aria-label="Event automations">
          {automations.map((a) => (
            <li key={a.id} className="py-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="font-medium text-ink">{a.name}</span>{" "}
                    <span className="text-sm text-ink-muted">
                      · {whenText(a)}: {EVENT_ACTIONS[a.action].charAt(0).toLowerCase() + EVENT_ACTIONS[a.action].slice(1)}
                    </span>
                  </span>
                  {a.enabled ? <Badge tone="success">On</Badge> : <Badge>{a.action === "message" && !a.approved ? "Waiting for an owner" : "Off"}</Badge>}
                </summary>
                <div className="mt-4 border-t border-line pt-4">
                  <AutomationForm automation={a} stages={stages} isOwner={isOwner} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line pt-6 first:border-t-0 first:pt-0">
        <h3 className="mb-3 text-sm font-semibold text-ink">New automation</h3>
        <AutomationForm automation={null} stages={stages} isOwner={isOwner} />
      </div>
    </div>
  );
}

function AutomationForm({ automation, stages, isOwner }: { automation: EventAutomation | null; stages: EventStage[]; isOwner: boolean }) {
  const [f, setF] = useState<EventAutomation>(automation ?? { ...BLANK, enabled: true });
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const problem = automationProblem(f);
  // A message's words changed: it waits for an owner again.
  const changed = Boolean(automation) && (automation!.body !== f.body || automation!.subject !== f.subject || automation!.trigger !== f.trigger);
  const ownerOnly = f.action === "message" && !isOwner && (!automation?.approved || changed);
  return (
    <form
      aria-label={automation ? `Edit ${automation.name}` : "New automation"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveEventAutomation({ ...f, enabled: ownerOnly ? false : f.enabled });
          setResult(r);
          if (r.ok && !automation) setF({ ...BLANK });
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Name
          <input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          When
          <select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value as EventTrigger, daysBefore: e.target.value === "days_before" ? (f.daysBefore ?? 30) : null })} className={selectClass}>
            {Object.entries(EVENT_TRIGGERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {f.trigger === "days_before" ? (
          <label className={labelClass}>
            Days before
            <input type="number" min={1} max={365} value={f.daysBefore ?? ""} onChange={(e) => setF({ ...f, daysBefore: Number(e.target.value) })} className={fieldClass} />
          </label>
        ) : (
          <label className={labelClass}>
            Wait (days)
            <input type="number" min={0} max={60} value={f.waitDays} onChange={(e) => setF({ ...f, waitDays: Number(e.target.value) })} className={fieldClass} />
          </label>
        )}
        <label className={labelClass}>
          Then
          <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as EventAction })} className={selectClass}>
            {Object.entries(EVENT_ACTIONS).map(([k, label]) => (
              <option key={k} value={k} disabled={k === "move_stage" && !stages.length}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {f.action === "task" && (
          <label className={`${labelClass} sm:col-span-2`}>
            To-do
            <input value={f.task ?? ""} maxLength={200} onChange={(e) => setF({ ...f, task: e.target.value })} className={fieldClass} />
          </label>
        )}
        {f.action === "move_stage" && (
          <label className={labelClass}>
            Stage
            <select value={f.stageId ?? ""} onChange={(e) => setF({ ...f, stageId: e.target.value || null })} className={selectClass}>
              <option value="">Choose a stage</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {f.action === "message" && (
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            Email subject
            <input value={f.subject ?? ""} maxLength={150} onChange={(e) => setF({ ...f, subject: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Message
            <textarea rows={4} value={f.body ?? ""} maxLength={1600} onChange={(e) => setF({ ...f, body: e.target.value })} className={fieldClass} />
          </label>
          <p className="text-13 text-ink-muted">You can use {MESSAGE_FIELDS.map((k) => `{${k}}`).join(", ")}. It goes on the channel the client allows, between 9am and 8pm.</p>
        </div>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input type="checkbox" className={checkboxClass} checked={ownerOnly ? false : f.enabled} disabled={ownerOnly} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        On
      </label>
      {ownerOnly && <p className="-mt-3 text-13 text-ink-muted">Only an owner can turn on a message to clients.</p>}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || Boolean(problem)} title={problem ?? undefined}>
          {automation ? "Save" : "Add automation"}
        </Button>
        {automation && (
          <Button variant="quiet" disabled={pending} onClick={() => start(async () => setResult(await deleteEventAutomation(automation.id)))}>
            Remove
          </Button>
        )}
      </div>
      {problem && f.name && <p className="text-13 text-ink-muted">{problem}</p>}
    </form>
  );
}
