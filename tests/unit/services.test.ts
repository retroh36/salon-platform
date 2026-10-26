import { describe, expect, it } from "vitest";
import {
  centsToInput,
  formatPrice,
  formatPriceRange,
  formatServiceTime,
  groupByCategory,
  parsePrice,
  parseServiceForm,
  stylistPrice,
} from "@/lib/services";

const STAFF_A = "d0000000-0000-4000-8000-00000000000a";
const STAFF_B = "d0000000-0000-4000-8000-00000000000b";

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const valid = {
  name: " Root Touch-Up ",
  category: "Color",
  description: "",
  active_minutes: "30",
  processing_minutes: "35",
  finishing_minutes: "20",
  price: "95",
};

describe("parsePrice", () => {
  it.each([
    ["85", 8500],
    ["85.5", 8550],
    ["85.50", 8550],
    ["$1,250.00", 125000],
    [" 0 ", 0],
    ["0.05", 5],
  ])("parses %j as %i cents", (input, cents) => {
    expect(parsePrice(input)).toBe(cents);
  });

  it.each(["", "abc", "-5", "85.555", "8 5", "$", "1e3"])("rejects %j", (input) => {
    expect(parsePrice(input)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats prices without needless cents", () => {
    expect(formatPrice(8500)).toBe("$85");
    expect(formatPrice(8550)).toBe("$85.50");
    expect(formatPrice(125000)).toBe("$1,250");
    expect(formatPrice(0)).toBe("$0");
  });

  it("round-trips cents to an input value", () => {
    expect(centsToInput(8500)).toBe("85");
    expect(centsToInput(8550)).toBe("85.50");
    expect(centsToInput(null)).toBe("");
    expect(parsePrice(centsToInput(12345))).toBe(12345);
  });

  it("shows total time and the processing gap", () => {
    expect(formatServiceTime({ active_minutes: 30, processing_minutes: 35, finishing_minutes: 20 })).toBe(
      "1 hr 25 min · 35 min processing",
    );
    expect(formatServiceTime({ active_minutes: 45, processing_minutes: 0, finishing_minutes: 0 })).toBe("45 min");
  });
});

describe("groupByCategory", () => {
  it("uses menu order for standard categories, then others alphabetically", () => {
    const groups = groupByCategory([
      { category: "Treatments", name: "Mask" },
      { category: "Extensions", name: "Tape-ins" },
      { category: "Cuts", name: "Men's Cut" },
      { category: "Cuts", name: "Bang Trim" },
      { category: "Barbering", name: "Shave" },
      { category: "Color", name: "Gloss" },
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Cuts", "Color", "Treatments", "Barbering", "Extensions"]);
    expect(groups[0].services.map((s) => s.name)).toEqual(["Bang Trim", "Men's Cut"]);
  });
});

describe("stylistPrice", () => {
  const service = { price_cents: 9500, levelPrices: { artisan: 7500, master: 11000 } };

  it("uses the stylist's own price first, then their level's, then the menu price", () => {
    expect(stylistPrice(service, { level: "master", customCents: 9000 })).toBe(9000);
    expect(stylistPrice(service, { level: "master", customCents: null })).toBe(11000);
    expect(stylistPrice(service, { level: "artisan", customCents: null })).toBe(7500);
    expect(stylistPrice(service, { level: "senior", customCents: null })).toBe(9500);
    expect(stylistPrice(service, { level: null, customCents: null })).toBe(9500);
    expect(stylistPrice({ price_cents: 4000 }, { level: "master", customCents: null })).toBe(4000);
  });

  it("formats a range of prices", () => {
    expect(formatPriceRange([7500, 11000, 9500])).toBe("$75–$110");
    expect(formatPriceRange([5000, 5000])).toBe("$50");
    expect(formatPriceRange([])).toBe("");
  });
});

describe("parseServiceForm", () => {
  it("parses a valid form", () => {
    const result = parseServiceForm(
      form({ ...valid, staff: [STAFF_A, STAFF_B], [`price_${STAFF_A}`]: "110", [`price_${STAFF_B}`]: "" }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Root Touch-Up",
        category: "Color",
        description: "",
        active_minutes: 30,
        processing_minutes: 35,
        finishing_minutes: 20,
        price_cents: 9500,
        level_prices: { artisan: null, senior: null, master: null },
        staff: [
          { staff_id: STAFF_A, price_cents: 11000 },
          { staff_id: STAFF_B, price_cents: null },
        ],
      },
    });
  });

  it("treats blank processing and finishing as zero", () => {
    const result = parseServiceForm(form({ ...valid, processing_minutes: "", finishing_minutes: "" }));
    expect(result.ok && [result.value.processing_minutes, result.value.finishing_minutes]).toEqual([0, 0]);
  });

  it("keeps a stylist's own price as typed, even if it matches the default (their level may charge more)", () => {
    const result = parseServiceForm(form({ ...valid, staff: STAFF_A, [`price_${STAFF_A}`]: "95.00" }));
    expect(result.ok && result.value.staff).toEqual([{ staff_id: STAFF_A, price_cents: 9500 }]);
  });

  it("parses prices by level, blank meaning the default", () => {
    const result = parseServiceForm(form({ ...valid, level_price_artisan: "75", level_price_senior: "", level_price_master: "$110.50" }));
    expect(result.ok && result.value.level_prices).toEqual({ artisan: 7500, senior: null, master: 11050 });
    const bad = parseServiceForm(form({ ...valid, level_price_master: "lots" }));
    expect(!bad.ok && bad.errors.level_prices).toEqual({ master: "Enter a price like 85, or leave blank." });
  });

  it("ignores duplicate staff ids", () => {
    const result = parseServiceForm(form({ ...valid, staff: [STAFF_A, STAFF_A] }));
    expect(result.ok && result.value.staff).toHaveLength(1);
  });

  it("reports every problem at once", () => {
    const result = parseServiceForm(
      form({
        name: " ",
        category: "",
        active_minutes: "0",
        processing_minutes: "-5",
        finishing_minutes: "7",
        price: "cheap",
        staff: STAFF_A,
        [`price_${STAFF_A}`]: "lots",
      }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual({
      name: "Enter a name.",
      category: "Enter a category.",
      active_minutes: "Must be at least 5 minutes.",
      processing_minutes: "Enter whole minutes.",
      finishing_minutes: "Use 5-minute steps.",
      price_cents: "Enter a price like 85 or 85.50.",
      staff: { [STAFF_A]: "Enter a price like 85 or 85.50, or leave blank." },
    });
  });

  it("requires a processing gap before finishing time", () => {
    const result = parseServiceForm(form({ ...valid, processing_minutes: "0", finishing_minutes: "15" }));
    expect(!result.ok && result.errors.finishing_minutes).toBe("Finishing time only applies after a processing gap.");
  });

  it("caps total time at 8 hours", () => {
    const result = parseServiceForm(
      form({ ...valid, active_minutes: "240", processing_minutes: "120", finishing_minutes: "125" }),
    );
    expect(!result.ok && result.errors.active_minutes).toBe("Total time must be 8 hours or less.");
  });
});
