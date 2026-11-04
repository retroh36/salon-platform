import { describe, expect, it } from "vitest";
import { canceledMessage, rescheduledMessage } from "@/lib/online-booking/messages";

// The fixed confirmations a client gets when they change or cancel a visit
// themselves online, with any fee and what happens to a deposit.
const base = { salon: "Maple & Ash", when: "Friday, November 6 at 10am", bookUrl: "https://x.test/book/maple-and-ash" };

describe("client-made changes", () => {
  it("confirms a reschedule with the link", () => {
    expect(rescheduledMessage({ salon: "Maple & Ash", when: "Friday, November 6 at 10am", manageUrl: "https://x.test/m/abc" })).toBe(
      "Maple & Ash: your visit is moved to Friday, November 6 at 10am. View, change or cancel: https://x.test/m/abc",
    );
  });

  it("confirms a cancellation with no fee", () => {
    expect(canceledMessage({ ...base, feeCents: 0, depositPaidCents: 0, cardLabel: null })).toBe(
      "Maple & Ash: your visit on Friday, November 6 at 10am is canceled. Book again any time: https://x.test/book/maple-and-ash",
    );
  });

  it("says a deposit goes back when there's no fee", () => {
    expect(canceledMessage({ ...base, feeCents: 0, depositPaidCents: 2500, cardLabel: null })).toContain("Your $25 deposit is being refunded to your card.");
  });

  it("says what a late cancellation costs and how it's paid", () => {
    expect(canceledMessage({ ...base, feeCents: 4000, depositPaidCents: 0, cardLabel: "Visa …4242" })).toContain(
      "A late cancellation fee of $40 applies, under our cancellation policy, charged to Visa …4242. We'll send a receipt when it's charged.",
    );
    expect(canceledMessage({ ...base, feeCents: 2000, depositPaidCents: 2500, cardLabel: "Visa …4242" })).toContain(
      "A late cancellation fee of $20 applies, under our cancellation policy, kept from your $25 deposit.",
    );
    expect(canceledMessage({ ...base, feeCents: 4000, depositPaidCents: 2500, cardLabel: null })).toContain(
      "A late cancellation fee of $40 applies, under our cancellation policy: your $25 deposit, and the rest charged to your card on file. We'll send a receipt when it's charged.",
    );
  });
});
