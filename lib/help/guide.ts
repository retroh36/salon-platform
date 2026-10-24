// The help guide (docs/help/*.md): one short page per task, for staff.
// Denise answers "How do I…?" from these pages only, through her read-only
// how_to tool (lib/denise/assistant.ts): the best page's steps, who can do
// it, and a button to the screen it starts on. Pure; ./load.ts reads the
// files.
//
// A page:
//   ---
//   title: Sell a gift card
//   keywords: gift card, voucher, ring up a gift card
//   who: owner, manager, front_desk
//   open: /checkout/new?from=/sales | Open new sale     (optional)
//   ---
//   One sentence. Then numbered steps, then optional "## Good to know"
//   and "## If it doesn't work" bullets.

import type { StaffRole } from "@/lib/staff";

export const ROLES: StaffRole[] = ["owner", "manager", "front_desk", "stylist"];

export type HelpPage = {
  slug: string;
  title: string;
  keywords: string[];
  who: StaffRole[];
  open: { path: string; label: string } | null;
  summary: string;
  steps: string[];
  // Bullets under any "## …" heading, with the heading: "Good to know", …
  sections: { heading: string; bullets: string[] }[];
};

export function parseHelpPage(slug: string, text: string): HelpPage {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${slug}: no front matter`);
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const title = fields.get("title");
  if (!title) throw new Error(`${slug}: no title`);
  const who = (fields.get("who") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const unknown = who.filter((r) => !ROLES.includes(r as StaffRole));
  if (!who.length || unknown.length) throw new Error(`${slug}: who must list roles from ${ROLES.join(", ")}`);
  let open: HelpPage["open"] = null;
  if (fields.get("open")) {
    const [path, label] = fields.get("open")!.split("|").map((s) => s.trim());
    if (!path?.startsWith("/") || !label) throw new Error(`${slug}: open is "/path | Button label"`);
    open = { path, label };
  }

  const summary: string[] = [];
  const steps: string[] = [];
  const sections: HelpPage["sections"] = [];
  for (const raw of match[2].split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{2,3}\s+(.*)$/);
    const step = line.match(/^\d+\.\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (heading) sections.push({ heading: heading[1], bullets: [] });
    else if (sections.length && bullet) sections[sections.length - 1].bullets.push(bullet[1]);
    else if (sections.length) {
      const s = sections[sections.length - 1];
      if (s.bullets.length) s.bullets[s.bullets.length - 1] += ` ${line}`;
      else s.bullets.push(line);
    } else if (step) steps.push(step[1]);
    else if (steps.length) steps[steps.length - 1] += ` ${line}`;
    else summary.push(line);
  }
  if (!steps.length) throw new Error(`${slug}: no numbered steps`);
  return {
    slug,
    title,
    keywords: (fields.get("keywords") ?? "").split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    who: who as StaffRole[],
    open,
    summary: summary.join(" "),
    steps,
    sections,
  };
}

// Words that say nothing about the task.
const STOP = new Set(
  "a an the i we you my our your me to do does did how can could should would will is are was be it its of for on in at with and or by from up this that what where when who which there here please way get make use using want wants need needs their them they someone somebody just now so if one more again also today tomorrow yesterday monday tuesday wednesday thursday friday saturday sunday maestra denise".split(" "),
);

// "Refunds" -> "refund", "booking" -> "book", "colour" -> "color".
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/colour/g, "color");
  if (w.length > 6 && w.endsWith("ment")) w = w.slice(0, -4);
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  return w;
}

// Words too common to say which task it is ("add", "client"): they count
// towards a page, but most of the rest of the question has to match too.
const GENERIC = new Set("add new change set see take make give open edit client sale salon service appointment staff".split(" "));

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w))
    .map(stem);

// How well a page answers the question: whole keyword phrases in the
// question count most, then words of the title and keywords, then words
// anywhere on the page.
export function scorePage(page: HelpPage, query: string): number {
  const q = words(query);
  if (!q.length) return 0;
  const qText = ` ${q.join(" ")} `;
  const title = new Set(words(page.title));
  const keys = new Set(page.keywords.flatMap(words));
  const body = new Set(words([page.summary, ...page.steps].join(" ")));
  let score = 0;
  if (words(page.title).join(" ") === q.join(" ")) score += 20;
  for (const k of page.keywords) {
    const kw = words(k);
    if (kw.length > 1 && qText.includes(` ${kw.join(" ")} `)) score += 4 * kw.length;
  }
  let named = 0;
  for (const w of new Set(q)) {
    if (title.has(w)) score += 3;
    if (keys.has(w)) score += 2;
    if (title.has(w) || keys.has(w)) named += 1;
    else if (body.has(w)) score += 0.5;
  }
  // The more of the title the question covers, the closer the page:
  // "refund" is "Refund a sale" before "Cancel a package with a refund".
  const covered = [...title].filter((w) => q.includes(w)).length;
  if (title.size) score += (4 * covered) / title.size;
  // Most of the question has to be what the page is about: "Apple Pay on
  // the card reader" shares "pay" and "card" with gift cards, but isn't one.
  const specific = [...new Set(q)].filter((w) => !GENERIC.has(w));
  const counted = specific.length ? specific : [...new Set(q)];
  const matched = counted.filter((w) => title.has(w) || keys.has(w)).length;
  return named && matched / counted.length > 0.5 ? score : 0;
}

export const MIN_SCORE = 2;

export function searchHelp(pages: HelpPage[], query: string, limit = 3): HelpPage[] {
  return pages
    .map((page) => ({ page, score: scorePage(page, query) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
    .slice(0, limit)
    .map((r) => r.page);
}

const ROLE_PLURAL: Record<StaffRole, string> = { owner: "owners", manager: "managers", front_desk: "the front desk", stylist: "stylists" };

// "owners and managers", "owners, managers and the front desk".
export function whoText(roles: StaffRole[]): string {
  const names = ROLES.filter((r) => roles.includes(r)).map((r) => ROLE_PLURAL[r]);
  if (names.length === ROLES.length) return "everyone";
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

const plain = (text: string) => text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]*)`/g, "$1");

// What the how_to tool gives Denise: the best page in full (its steps
// only when the person asking can do it), and the titles of others close
// to the question, which she can ask for by title.
export function howTo(pages: HelpPage[], query: string, role: StaffRole) {
  const [best, ...others] = searchHelp(pages, query);
  if (!best) {
    return { found: false as const, note: "Nothing in the Maestra help guide covers that. Say it isn't in the guide, and don't guess how it works." };
  }
  const canDo = best.who.includes(role);
  return {
    found: true as const,
    page: {
      title: best.title,
      can_do: canDo,
      who_can: whoText(best.who),
      ...(canDo
        ? { summary: plain(best.summary), steps: best.steps.map(plain), notes: best.sections.map((s) => ({ heading: s.heading, bullets: s.bullets.map(plain) })) }
        : { summary: plain(best.summary) }),
      button: canDo && best.open ? best.open.label : null,
    },
    other_pages: others.map((p) => p.title),
    // For the button under her answer.
    link: canDo ? best.open : null,
  };
}
