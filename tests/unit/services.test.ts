import { describe, expect, it } from "vitest";
import {
  centsToInput,
  formatMinutes,
  formatPrice,
  formatServiceTime,
  groupByCategory,
  parsePrice,
  parseServiceForm,
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

  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(85)).toBe("1h 25m");
  });

  it("shows total time and the processing gap", () => {
    expect(formatServiceTime({ active_minutes: 30, processing_minutes: 35, finishing_minutes: 20 })).toBe(
      "1h 25m · 35m processing",
    );
    expect(formatServiceTime({ active_minutes: 45, processing_minutes: 0, finishing_minutes: 0 })).toBe("45m");
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

  it("stores a stylist price equal to the default as the default", () => {
    const result = parseServiceForm(form({ ...valid, staff: STAFF_A, [`price_${STAFF_A}`]: "95.00" }));
    expect(result.ok && result.value.staff).toEqual([{ staff_id: STAFF_A, price_cents: null }]);
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
