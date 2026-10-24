"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/page";
import { LOGIN_LABELS, type LoginState } from "@/lib/team";
import { inviteTeamMember, resetTeamPassword, setMemberActive } from "./actions";
import type { LoginResult } from "@/lib/team-logins";

// Their login: none yet (invite them), invited (send it again), or signs
// in (owners can send a password reset).
export function LoginCard({ staffId, firstName, state, email, canReset, active }: { staffId: string; firstName: string; state: LoginState; email: string | null; canReset: boolean; active: boolean }) {
  const [result, setResult] = useState<LoginResult | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<LoginResult>) => start(async () => setResult(await fn()));
  return (
    <section aria-label="Login" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold text-ink">Login</h2>
        <Badge tone={state === "active" ? "green" : state === "invited" ? "amber" : "neutral"}>{LOGIN_LABELS[state]}</Badge>
      </div>
      <p className="text-sm text-ink-muted" data-testid="login-note">
        {state === "none"
          ? email
            ? `Send ${firstName} an email to choose a password and sign in with ${email}.`
            : `Add ${firstName}'s email above, then send an invite.`
          : state === "invited"
            ? `${firstName} hasn't signed in yet. You can send the invite again.`
            : `${firstName} signs in with ${email ?? "their email"}.`}
      </p>
      {active && (
        <div className="flex flex-wrap gap-2">
          {state === "none" && (
            <Button variant="primary" disabled={pending || !email} onClick={() => run(() => inviteTeamMember(staffId))}>
              Send invite
            </Button>
          )}
          {state === "invited" && (
            <Button disabled={pending} onClick={() => run(() => inviteTeamMember(staffId))}>
              Send the invite again
            </Button>
          )}
          {state === "active" && canReset && (
            <Button disabled={pending} onClick={() => run(() => resetTeamPassword(staffId))}>
              Send a password reset
            </Button>
          )}
        </div>
      )}
      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-ink-muted" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </section>
  );
}

// Someone leaving: deactivated (asked first), never deleted, so their
// visits, sales and pay stay. Or back again.
export function ActiveCard({ staffId, firstName, active, upcoming, isMe }: { staffId: string; firstName: string; active: boolean; upcoming: number; isMe: boolean }) {
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<LoginResult | null>(null);
  const [pending, start] = useTransition();
  const set = (on: boolean) =>
    start(async () => {
      setResult(await setMemberActive(staffId, on));
      setAsking(false);
    });
  return (
    <section aria-label="Leaving" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-serif text-lg font-semibold text-ink">{active ? "Leaving the salon" : "Deactivated"}</h2>
      {active ? (
        isMe ? (
          <p className="text-sm text-ink-muted">You can&apos;t deactivate yourself.</p>
        ) : asking ? (
          <div role="group" aria-label="Deactivate" className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              Deactivate {firstName}? They won&apos;t be able to sign in or be booked. Their visits, sales and pay history stay.
              {upcoming > 0 && ` ${firstName} still has ${upcoming} visit${upcoming === 1 ? "" : "s"} booked from today: move them to someone else first.`}
            </p>
            <div className="flex gap-2">
              <Button variant="danger" disabled={pending} onClick={() => set(false)}>
                Deactivate
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-muted">When someone leaves, deactivate them rather than deleting: everything they did stays.</p>
            <Button className="self-start" onClick={() => setAsking(true)}>
              Deactivate {firstName}
            </Button>
          </>
        )
      ) : (
        <>
          <p className="text-sm text-ink-muted">{firstName} can&apos;t sign in or be booked. Everything they did is kept.</p>
          <Button className="self-start" disabled={pending} onClick={() => set(true)}>
            Reactivate {firstName}
          </Button>
        </>
      )}
      {result && <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>}
    </section>
  );
}
