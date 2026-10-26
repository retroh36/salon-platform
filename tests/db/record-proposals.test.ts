import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SEED, signIn, type Client } from "./helpers";

// Denise's scans can run at the same moment (a no-show starts one while the
// calendar runs its own). Recording the same subject from both must not
// break the unique rule on open proposals: the second updates the first's
// (migration …_record_proposals_one_at_a_time.sql).

const SUBJECT = `test:race:${Date.now()}`;
let sessions: Client[];

beforeAll(async () => {
  sessions = await Promise.all([signIn("frontdesk@mapleandash.test"), signIn("manager@mapleandash.test"), signIn("owner@mapleandash.test")]);
});

afterAll(async () => {
  await admin.from("ai_actions").delete().eq("location_id", SEED.location).like("subject", `${SUBJECT}:%`);
});

describe("record_ai_proposals", () => {
  it("records the same subject from several scans at once without a clash", async () => {
    const options = [
      { summary: "Move Ava to 2pm", reason: "Bridget runs over.", proposal: {} },
      { summary: "Move Ava to Gil", reason: "Gil is free.", proposal: {} },
    ];
    // A race doesn't show every time, so several rounds of twelve at once.
    for (let round = 0; round < 5; round++) {
      const subject = `${SUBJECT}:${round}`;
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => sessions[i % sessions.length].rpc("record_ai_proposals", { p_location_id: SEED.location, p_feature: "test", p_subject: subject, p_options: options as never })),
      );
      expect(results.map((r) => r.error)).toEqual(results.map(() => null));
      // Every scan got the same two proposals back.
      expect(new Set(results.map((r) => JSON.stringify(r.data))).size).toBe(1);
      const { data } = await admin.from("ai_actions").select("rank").eq("location_id", SEED.location).eq("subject", subject).order("rank");
      expect(data).toEqual([{ rank: 1 }, { rank: 2 }]);
    }
  });
});
