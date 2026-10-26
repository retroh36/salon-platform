// Denise's answers as blocks to draw: paragraphs, bullet lists and numbered
// lists, with **bold** runs, so a list never shows as raw hyphens or
// asterisks. Pure (no React), so it's unit-tested; components/denise-text.tsx
// draws it.

export type Run = { text: string; bold: boolean };
export type Block = { kind: "paragraph"; lines: Run[][] } | { kind: "bullets" | "numbers"; items: Run[][]; start: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,2})[.)]\s+(.*)$/;

// **bold** (or __bold__) runs; a stray asterisk left over is dropped.
export function runs(line: string): Run[] {
  const out: Run[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index), bold: false });
    out.push({ text: m[1] ?? m[2], bold: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at), bold: false });
  return out.map((r) => ({ ...r, text: r.text.replace(/\*\*?/g, "") })).filter((r) => r.text);
}

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let last = null as Block | null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      last = null;
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    // A heading-ish line ("**Today**" or "### Today") reads as a bold paragraph line.
    const plain = line.replace(/^\s*#{1,6}\s+/, "");
    if (bullet || number) {
      const kind = bullet ? "bullets" : "numbers";
      const item = runs((bullet ? bullet[1] : number![2]).trim());
      if (last?.kind === kind) last.items.push(item);
      else out.push((last = { kind, items: [item], start: number ? Number(number[1]) : 1 }));
    } else if (last?.kind === "paragraph") {
      last.lines.push(runs(plain.trim()));
    } else if (last && /^\s{2,}/.test(raw)) {
      // An indented line carries on the item above.
      last.items[last.items.length - 1].push({ text: ` ${plain.trim()}`, bold: false });
    } else {
      out.push((last = { kind: "paragraph", lines: [runs(plain.trim())] }));
    }
  }
  return out;
}
