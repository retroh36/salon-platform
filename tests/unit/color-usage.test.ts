import { describe, expect, it } from "vitest";
import { describeUsage, MAX_LINES, parseUsageLines, type UsageProduct } from "@/lib/color-usage";

const products = new Map<string, UsageProduct>([
  ["7n", { id: "7n", brand: "Goldwell", line: "Topchic", name: "7N", unit: "g" }],
  ["20v", { id: "20v", brand: "Goldwell", line: "Topchic", name: "20 Vol Developer (6%)", unit: "ml" }],
]);

describe("formula and recipe lines", () => {
  it("reads products and amounts, including partial grams", () => {
    expect(parseUsageLines(JSON.stringify([{ productId: "7n", amount: 22.5 }, { productId: "20v", amount: "45" }]), products)).toEqual({
      ok: true,
      lines: [
        { productId: "7n", amount: 22.5 },
        { productId: "20v", amount: 45 },
      ],
    });
    expect(parseUsageLines("", products)).toEqual({ ok: true, lines: [] });
  });

  it("refuses unknown products, bad amounts and too many lines", () => {
    expect(parseUsageLines([{ productId: "nope", amount: 30 }], products)).toEqual({ ok: false, error: "Choose a product for each line." });
    for (const amount of [0, -5, 1.234, "abc", 20000]) {
      expect(parseUsageLines([{ productId: "7n", amount }], products)).toEqual({ ok: false, error: "Enter an amount for each product, e.g. 30." });
    }
    expect(parseUsageLines("{not json", products).ok).toBe(false);
    expect(parseUsageLines(Array.from({ length: MAX_LINES + 1 }, () => ({ productId: "7n", amount: 1 })), products).ok).toBe(false);
  });

  it("writes them as a formula", () => {
    expect(describeUsage([{ productId: "7n", amount: 30 }, { productId: "20v", amount: 30 }], products)).toBe(
      "30 g Goldwell Topchic 7N + 30 ml Goldwell Topchic 20 Vol Developer (6%)",
    );
  });
});
