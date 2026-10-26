import { describe, expect, it } from "vitest";
import { blocks, runs } from "@/lib/rich-text";

describe("Denise's answers as blocks", () => {
  it("turns hyphen and asterisk lines into one bullet list", () => {
    expect(blocks("Three regulars are due:\n- Ava, 2 weeks over\n* Mia\n• Zoe")).toEqual([
      { kind: "paragraph", lines: [[{ text: "Three regulars are due:", bold: false }]] },
      { kind: "bullets", start: 1, items: [[{ text: "Ava, 2 weeks over", bold: false }], [{ text: "Mia", bold: false }], [{ text: "Zoe", bold: false }]] },
    ]);
  });

  it("keeps numbered steps numbered, from their first number", () => {
    const [list] = blocks("1. Open Sales\n2. Tap New sale");
    expect(list).toMatchObject({ kind: "numbers", start: 1 });
    expect(list.kind !== "paragraph" && list.items.map((i) => i[0].text)).toEqual(["Open Sales", "Tap New sale"]);
  });

  it("draws **bold** runs and drops stray asterisks", () => {
    expect(runs("**Gil** is free at *3pm*")).toEqual([
      { text: "Gil", bold: true },
      { text: " is free at 3pm", bold: false },
    ]);
  });

  it("splits paragraphs on blank lines and keeps line breaks inside one", () => {
    const out = blocks("First line\nsecond line\n\nNew paragraph");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "paragraph", lines: [[{ text: "First line" }], [{ text: "second line" }]] });
  });

  it("reads a markdown heading as a plain line", () => {
    expect(blocks("### Today")).toEqual([{ kind: "paragraph", lines: [[{ text: "Today", bold: false }]] }]);
  });

  it("leaves a hyphen inside a sentence alone", () => {
    expect(blocks("A walk-in - maybe at 3")).toEqual([{ kind: "paragraph", lines: [[{ text: "A walk-in - maybe at 3", bold: false }]] }]);
  });
});
