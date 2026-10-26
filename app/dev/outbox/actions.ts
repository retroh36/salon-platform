"use server";

import { revalidatePath } from "next/cache";
import { handleInboundText } from "@/lib/messaging/inbound";
import { isDemo } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";

// Development and the demo only: the client replies to a text, as if from their phone
// (STOP, START or HELP), handled as the text provider's webhook would be;
// our reply lands in the outbox.
export async function replyAsClient(to: string, word: "STOP" | "START" | "HELP") {
  if (process.env.NODE_ENV === "production" && !isDemo()) return;
  const digits = to.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (!/^\d{10}$/.test(digits)) return;
  const admin = createAdminClient();
  const reply = await handleInboundText(admin, digits, word);
  if (reply) await admin.from("outbox_messages").insert({ channel: "sms", to_address: digits, body: reply });
  revalidatePath("/dev/outbox");
}
