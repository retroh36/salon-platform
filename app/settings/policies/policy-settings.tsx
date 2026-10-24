"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkboxClass, Eyebrow, fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { parseFeeRule, policyText, type CardRule, type FeeKind, type FeeRule, type PolicyErrors, type PolicySettings, type RepeatAction, type StaffPolicy } from "@/lib/policy";
import { savePolicy, saveStaffPolicy, type PolicyResult } from "./actions";

const FEE_KINDS: { value: FeeKind; label: string }[] = [
  { value: "none", label: "No fee" },
  { value: "fixed", label: "A fixed amount" },
  { value: "percent", label: "A percent of the visit" },
  { value: "deposit", label: "The deposit (kept)" },
];

const CARD_RULES: { value: CardRule; label: string }[] = [
  { value: "off", label: "Never" },
  { value: "all", label: "For every booking" },
  { value: "new_clients", label: "For new clients" },
  { value: "some", label: "For some services or stylists" },
];

const amountText = (r: FeeRule) => (r.kind === "fixed" ? String(r.amount / 100) : r.kind === "percent" ? String(r.amount) : "");

function FeeField({ name, label, value, error, onChange }: { name: string; label: string; value: { kind: FeeKind; amount: string }; error?: string; onChange: (v: { kind: FeeKind; amount: string }) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      <div className="flex flex-wrap gap-2">
        <select name={`${name}_kind`} aria-label={`${label} fee`} value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as FeeKind })} className={`${selectClass} w-auto`}>
          {FEE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {(value.kind === "fixed" || value.kind === "percent") && (
          <label className="flex items-center gap-1.5 text-sm">
            {value.kind === "fixed" && "$"}
            <input
              name={`${name}_amount`}
              aria-label={`${label} ${value.kind === "fixed" ? "amount" : "percent"}`}
              inputMode="decimal"
              value={value.amount}
              onChange={(e) => onChange({ ...value, amount: e.target.value })}
              aria-invalid={!!error}
              className={`${fieldClass} w-24`}
            />
            {value.kind === "percent" && "%"}
          </label>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

export function PolicyForm({
  initial,
  waiveRoles,
  extra,
  salon,
  services,
  stylists,
}: {
  initial: PolicySettings;
  waiveRoles: string[];
  extra: string;
  salon: string;
  services: { id: string; name: string }[];
  stylists: { id: string; name: string }[];
}) {
  const [card, setCard] = useState<CardRule>(initial.cardRequired);
  const [window, setWindow] = useState(String(initial.windowHours));
  const [late, setLate] = useState({ kind: initial.lateCancel.kind, amount: amountText(initial.lateCancel) });
  const [noShow, setNoShow] = useState({ kind: initial.noShow.kind, amount: amountText(initial.noShow) });
  const [longHold, setLongHold] = useState(initial.longHoldDays ? String(initial.longHoldDays) : "");
  const [repeat, setRepeat] = useState<RepeatAction>(initial.repeatAction);
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [pending, start] = useTransition();
  const errors: PolicyErrors = (result && !result.ok && result.errors) || {};

  // The live preview, as clients will read it.
  const rule = (v: { kind: FeeKind; amount: string }): FeeRule => {
    const r = parseFeeRule(v.kind, v.amount);
    return typeof r === "string" ? { kind: "none", amount: 0 } : r;
  };
  const preview = policyText(
    { ...initial, windowHours: Number(window) || initial.windowHours, lateCancel: rule(late), noShow: rule(noShow), longHoldDays: Number(longHold) || null },
    { salon, extra },
  );

  return (
    <form
      aria-label="Cancellation policy"
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => setResult(await savePolicy(form)));
      }}
    >
      <section className="flex flex-col gap-3">
        <Eyebrow>Card on file</Eyebrow>
        <label className={`${labelClass} max-w-sm`}>
          Ask for a card to book
          <select name="card_required" value={card} onChange={(e) => setCard(e.target.value as CardRule)} className={selectClass}>
            {CARD_RULES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {card === "some" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-medium">Services</legend>
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="card_service_ids" value={s.id} defaultChecked={initial.cardServiceIds.includes(s.id)} className={checkboxClass} />
                  {s.name}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
              <legend className="px-1 text-sm font-medium">Stylists</legend>
              {stylists.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="card_staff_ids" value={s.id} defaultChecked={initial.cardStaffIds.includes(s.id)} className={checkboxClass} />
                  {s.name}
                </label>
              ))}
            </fieldset>
          </div>
        )}
        {errors.cardRequired && <p className="text-sm text-danger">{errors.cardRequired}</p>}
        <p className="text-sm text-ink-muted">Online, the card is saved before the booking is confirmed. At the desk, send the client a secure link; the booking shows &ldquo;Card needed&rdquo; until it&rsquo;s done.</p>
      </section>

      <section className="flex flex-col gap-4">
        <Eyebrow>Cancellations and no-shows</Eyebrow>
        <label className={`${labelClass} max-w-xs`}>
          Cancellation window (hours before the visit)
          <input name="window_hours" inputMode="numeric" value={window} onChange={(e) => setWindow(e.target.value)} aria-invalid={!!errors.windowHours} className={fieldClass} />
          {errors.windowHours && <span className="text-sm font-normal text-danger">{errors.windowHours}</span>}
        </label>
        <FeeField name="late" label="Late cancellation" value={late} error={errors.lateCancel} onChange={setLate} />
        <FeeField name="no_show" label="No-show" value={noShow} error={errors.noShow} onChange={setNoShow} />
        <label className={`${labelClass} max-w-md`}>
          <span>
            Only charge the late-cancel fee for visits booked at least this many days ahead <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input name="long_hold_days" inputMode="numeric" placeholder="e.g. 21" value={longHold} onChange={(e) => setLongHold(e.target.value)} aria-invalid={!!errors.longHoldDays} className={`${fieldClass} w-28`} />
          <span className="text-xs font-normal text-ink-muted">For visits that held a spot for weeks. A deposit is always kept on a late cancellation.</span>
          {errors.longHoldDays && <span className="text-sm font-normal text-danger">{errors.longHoldDays}</span>}
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Repeat offenders</Eyebrow>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className={labelClass}>
            After
            <input name="repeat_count" inputMode="numeric" defaultValue={initial.repeatCount} aria-invalid={!!errors.repeatCount} className={`${fieldClass} w-20`} />
          </label>
          <span className="pb-2">late cancellations or no-shows in</span>
          <label className={labelClass}>
            Months
            <input name="repeat_months" inputMode="numeric" defaultValue={initial.repeatMonths} aria-invalid={!!errors.repeatMonths} className={`${fieldClass} w-20`} />
          </label>
          <label className={labelClass}>
            ask for
            <select name="repeat_action" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatAction)} className={`${selectClass} w-auto`}>
              <option value="off">Nothing more</option>
              <option value="deposit">A deposit</option>
              <option value="prepay">The whole visit up front</option>
            </select>
          </label>
          {repeat === "deposit" && (
            <label className={labelClass}>
              Deposit (% of the visit)
              <input name="repeat_deposit_percent" inputMode="numeric" defaultValue={initial.repeatDepositPercent} aria-invalid={!!errors.repeatDepositPercent} className={`${fieldClass} w-20`} />
            </label>
          )}
        </div>
        {(errors.repeatCount || errors.repeatMonths || errors.repeatDepositPercent) && <p className="text-sm text-danger">{errors.repeatCount ?? errors.repeatMonths ?? errors.repeatDepositPercent}</p>}
        <p className="text-sm text-ink-muted">Waived fees don&rsquo;t count. Denise points them out when they book at the desk; online, they pay ahead to confirm.</p>
      </section>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium text-ink">Who can waive a fee</legend>
        <p className="mb-1 text-sm text-ink-muted">Owners always can. A reason is always asked for, and every waiver is logged.</p>
        {(
          [
            ["manager", "Managers"],
            ["front_desk", "Front desk"],
          ] as const
        ).map(([role, label]) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="waive_roles" value={role} defaultChecked={waiveRoles.includes(role)} className={checkboxClass} />
            {label}
          </label>
        ))}
      </fieldset>

      <section aria-label="What clients see" className="rounded-lg border border-line bg-sunken/60 p-4">
        <Eyebrow className="mb-2">What clients see</Eyebrow>
        <div className="flex flex-col gap-1.5 text-sm text-ink" data-testid="policy-preview">
          {preview.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">Anything else to add goes in Settings → Online booking, under Cancellation policy.</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          Save policy
        </Button>
        {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
      </div>
    </form>
  );
}

// Each stylist's own rules: a longer window, higher fees, or the salon's.
export function StaffPolicies({ stylists, policies }: { stylists: { id: string; name: string }[]; policies: StaffPolicy[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {stylists.map((s) => (
        <StaffPolicyRow key={s.id} stylist={s} policy={policies.find((p) => p.staffId === s.id) ?? null} />
      ))}
    </ul>
  );
}

function summary(p: StaffPolicy | null): string {
  if (!p) return "The salon's rules";
  const fee = (r: FeeRule | null, what: string) => r && (r.kind === "fixed" ? `${what} $${r.amount / 100}` : r.kind === "percent" ? `${what} ${r.amount}%` : r.kind === "deposit" ? `${what}: deposit` : null);
  return [p.windowHours && `${p.windowHours}-hour window`, fee(p.lateCancel, "late cancel"), fee(p.noShow, "no-show")].filter(Boolean).join(" · ") || "The salon's rules";
}

function StaffPolicyRow({ stylist, policy }: { stylist: { id: string; name: string }; policy: StaffPolicy | null }) {
  const [open, setOpen] = useState(false);
  const [window, setWindow] = useState(policy?.windowHours ? String(policy.windowHours) : "");
  const [late, setLate] = useState({ kind: (policy?.lateCancel?.kind ?? "") as FeeKind | "", amount: policy?.lateCancel ? amountText(policy.lateCancel) : "" });
  const [noShow, setNoShow] = useState({ kind: (policy?.noShow?.kind ?? "") as FeeKind | "", amount: policy?.noShow ? amountText(policy.noShow) : "" });
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [pending, start] = useTransition();
  const kinds = (label: string, v: { kind: FeeKind | ""; amount: string }, set: (v: { kind: FeeKind | ""; amount: string }) => void) => (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={`${label} for ${stylist.name}`} value={v.kind} onChange={(e) => set({ ...v, kind: e.target.value as FeeKind | "" })} className={`${selectClass} w-auto`}>
        <option value="">The salon&rsquo;s</option>
        {FEE_KINDS.filter((k) => k.value !== "none").map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      {(v.kind === "fixed" || v.kind === "percent") && (
        <input aria-label={`${label} amount for ${stylist.name}`} inputMode="decimal" value={v.amount} onChange={(e) => set({ ...v, amount: e.target.value })} className={`${fieldClass} w-24`} placeholder={v.kind === "fixed" ? "$" : "%"} />
      )}
    </div>
  );
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{stylist.name}</p>
          <p className="text-sm text-ink-muted">{summary(policy)}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Close" : "Edit"}
        </Button>
      </div>
      {open && (
        <form
          aria-label={`Rules for ${stylist.name}`}
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => setResult(await saveStaffPolicy({ staffId: stylist.id, windowHours: window, lateKind: late.kind, lateAmount: late.amount, noShowKind: noShow.kind, noShowAmount: noShow.amount })));
          }}
        >
          <label className={`${labelClass} max-w-xs`}>
            Window (hours)
            <input inputMode="numeric" placeholder="The salon's" value={window} onChange={(e) => setWindow(e.target.value)} className={`${fieldClass} w-28`} />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            Late cancellation
            {kinds("Late cancellation", late, setLate)}
          </div>
          <div className="flex flex-col gap-1.5 text-sm font-medium">
            No-show
            {kinds("No-show", noShow, setNoShow)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              Save
            </Button>
            {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
          </div>
        </form>
      )}
    </li>
  );
}
