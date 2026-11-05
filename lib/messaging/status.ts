// What Settings → Messages says about real texts and email (pure,
// unit-tested): whether each is connected (its keys are set on Maestra),
// whether this copy may send at all (the go-live gate), and whether the
// salon has turned on "Go live". Messages reach clients only when all
// three are true; otherwise they wait in the outbox, as they always have.

import { liveGate, resendKeys, twilioKeys } from "../live.ts";

type Env = Record<string, string | undefined>;

export type ChannelStatus = { connected: boolean; label: "Connected" | "Not connected" };

export type MessagingStatus = {
  texts: ChannelStatus;
  email: ChannelStatus;
  // Why this copy never sends (the demo, staging…), or null on production.
  blocked: string | null;
  live: boolean;
  // Whether real messages are going out right now.
  sending: boolean;
  // Why "Go live" can't be turned on, or null if it can.
  cantGoLive: string | null;
  summary: string;
};

const status = (connected: boolean): ChannelStatus => ({ connected, label: connected ? "Connected" : "Not connected" });

export function messagingStatus(business: { messages_live: boolean }, env: Env = process.env): MessagingStatus {
  const texts = status(!!twilioKeys(env));
  const email = status(!!resendKeys(env));
  const gate = liveGate(env);
  const blocked = gate.open ? null : gate.reason;
  const sending = business.messages_live && !blocked && (texts.connected || email.connected);
  const cantGoLive = blocked ?? (!texts.connected && !email.connected ? "Texts and email aren't connected yet. The Maestra team connects them." : null);
  let summary: string;
  if (sending) {
    summary = texts.connected && email.connected ? "Texts and emails are going to clients." : texts.connected ? "Texts are going to clients. Emails wait in the outbox until email is connected." : "Emails are going to clients. Texts wait in the outbox until texts are connected.";
  } else if (business.messages_live) {
    summary = `Turned on, but nothing is sent from here: ${blocked ?? "texts and email aren't connected."}`;
  } else {
    summary = "Messages wait in the outbox. Nothing reaches clients until you go live.";
  }
  return { texts, email, blocked, live: business.messages_live, sending, cantGoLive, summary };
}
