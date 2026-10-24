// The help guide (docs/help/) and Denise's how_to tool: every page is well
// formed and points at a real screen, questions find the right page, roles
// are respected, and nothing outside the guide is made up. No API calls.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { answer, type AssistantContext } from "@/lib/denise/assistant";
import { CHAT_MODEL, type ClaudeClient } from "@/lib/denise/claude";
import { howTo, parseHelpPage, searchHelp, whoText } from "@/lib/help/guide";
import { loadHelpPages } from "@/lib/help/load";

const pages = loadHelpPages();
const titled = (title: string) => pages.find((p) => p.title === title)!;

// app/<path>/page.tsx or route.ts, with [dynamic] folders allowed.
function isScreen(path: string): boolean {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const dir = join(process.cwd(), "app", ...parts);
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"));
}

describe("the pages", () => {
  it("are all there and well formed", () => {
    expect(pages.length).toBeGreaterThanOrEqual(60);
    for (const p of pages) {
      expect(p.steps.length, p.slug).toBeGreaterThanOrEqual(2);
      expect(p.steps.length, p.slug).toBeLessThanOrEqual(12);
      expect(p.keywords.length, p.slug).toBeGreaterThan(0);
      expect(p.summary, p.slug).not.toBe("");
    }
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
  });

  it("open real screens, with an Open… button", () => {
    for (const p of pages.filter((p) => p.open)) {
      expect(isScreen(p.open!.path), `${p.slug}: ${p.open!.path}`).toBe(true);
      expect(p.open!.label, p.slug).toMatch(/^Open /);
    }
  });

  it("refuse a page without steps or with unknown roles", () => {
    expect(() => parseHelpPage("x", "---\ntitle: X\nwho: owner\n---\nNo steps.")).toThrow(/steps/);
    expect(() => parseHelpPage("x", "---\ntitle: X\nwho: cashier\n---\n1. Tap.")).toThrow(/roles/);
    const p = parseHelpPage("x", "---\ntitle: Do a thing\nkeywords: thing\nwho: owner, manager\nopen: /sales | Open Sales\n---\nWhat it is.\n\n1. Tap **Sales**.\n2. Tap it\n   again.\n\n## Good to know\n\n- One.\n- Two.\n");
    expect(p).toMatchObject({ title: "Do a thing", who: ["owner", "manager"], open: { path: "/sales", label: "Open Sales" }, summary: "What it is.", steps: ["Tap **Sales**.", "Tap it again."] });
    expect(p.sections).toEqual([{ heading: "Good to know", bullets: ["One.", "Two."] }]);
  });
});

describe("finding the page", () => {
  it.each([
    ["How do I ring up a gift card", "Sell a gift card"],
    ["how do I take a gift card as payment", "Pay with a gift card"],
    ["check a gift card balance", "Check a gift card balance"],
    ["refund", "Refund a sale"],
    ["how do I void a sale", "Void a sale"],
    ["sell a membership", "Sell a membership"],
    ["download all our data", "Download all your data"],
    ["how do I charge a no-show fee", "Charge a no-show or late cancellation fee"],
    ["waive the late cancel fee", "Waive a cancellation or no-show fee"],
    ["send a card link", "Ask a client for a card on file"],
    ["set our cancellation policy", "Set up your cancellation policy"],
  ])("%s → %s", (question, title) => {
    expect(searchHelp(pages, question)[0]?.title).toBe(title);
  });

  it("says when the guide doesn't cover it", () => {
    expect(howTo(pages, "how do I fly a plane", "front_desk")).toMatchObject({ found: false });
    expect(howTo(pages, "how do I", "front_desk")).toMatchObject({ found: false });
  });
});

describe("roles", () => {
  it("gives the steps and the button to someone who can do it", () => {
    const r = howTo(pages, "How do I ring up a gift card", "front_desk");
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.page.can_do).toBe(true);
    expect((r.page as { steps?: string[] }).steps!.length).toBeGreaterThan(2);
    expect((r.page as { steps?: string[] }).steps!.join(" ")).not.toContain("**");
    expect(r.link).toEqual({ path: "/checkout/new?from=/sales", label: "Open new sale" });
  });

  it("tells a stylist who can, without the steps or a button", () => {
    const r = howTo(pages, "how do I void a sale", "stylist");
    expect(r).toMatchObject({ found: true, page: { title: "Void a sale", can_do: false, who_can: "owners and managers", button: null }, link: null });
    if (r.found) expect((r.page as { steps?: string[] }).steps).toBeUndefined();
  });

  it("names roles in plain words", () => {
    expect(whoText(["manager", "owner"])).toBe("owners and managers");
    expect(whoText(["owner", "manager", "front_desk"])).toBe("owners, managers and the front desk");
    expect(whoText(["owner", "manager", "front_desk", "stylist"])).toBe("owners, managers, the front desk and stylists");
    expect(whoText(["owner", "manager", "front_desk", "stylist", "assistant"])).toBe("everyone");
    expect(titled("Sell a gift card").who).not.toContain("stylist");
  });
});

describe("Denise answering from the guide", () => {
  // Claude looks it up, then answers; scripted.
  function scripted(query: string) {
    const requests: Record<string, unknown>[] = [];
    const responses = [
      { content: [{ type: "tool_use", id: "t1", name: "how_to", input: { query } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "1. Tap New sale." }], stop_reason: "end_turn" },
    ];
    const create = vi.fn(async (params: Record<string, unknown>) => {
      requests.push(structuredClone(params));
      return { id: "m", type: "message", role: "assistant", model: CHAT_MODEL, stop_sequence: null, usage: {}, ...responses.shift()! };
    });
    return { client: { messages: { create } } as unknown as ClaudeClient, requests };
  }
  const context = (role: "front_desk" | "stylist") =>
    ({ salon: "Maple & Ash", timeZone: "America/Chicago", today: "2026-10-27", date: "2026-10-27", now: new Date("2026-10-27T14:00:00Z"), services: [], staff: [], calendar: async () => null, propose: async () => null, help: pages, role }) as unknown as AssistantContext;

  it("gets the page's steps and puts its button under her answer", async () => {
    const { client, requests } = scripted("sell a gift card");
    const result = await answer(client, context("front_desk"), [{ role: "user", text: "How do I ring up a gift card" }]);
    expect(result.links).toEqual([{ path: "/checkout/new?from=/sales", label: "Open new sale" }]);
    expect(String(requests[0].system)).toMatch(/answer only from the page/);
    const toolResult = JSON.parse(((requests[1].messages as { content: { content: string }[] }[])[2].content[0]).content);
    expect(toolResult.page.title).toBe("Sell a gift card");
    expect(toolResult.page.steps.length).toBeGreaterThan(2);
  });

  it("gives a stylist no button for something they can't do", async () => {
    const { client } = scripted("void a sale");
    expect((await answer(client, context("stylist"), [{ role: "user", text: "How do I void a sale?" }])).links).toEqual([]);
  });
});
