import { describe, expect, it } from "vitest";
import { locationLabel } from "@/lib/branding";

describe("locationLabel", () => {
  it("drops the words the location shares with the salon's name", () => {
    expect(locationLabel("Maple & Ash Hair Studio", "Maple & Ash Downtown")).toBe("Downtown");
    expect(locationLabel("Harbor & Vine Salon and Spa", "Harbor & Vine Riverside")).toBe("Riverside");
    expect(locationLabel("Maple & Ash", "maple & ash  Lincoln Park")).toBe("Lincoln Park");
    expect(locationLabel("Lumen", "Lumen Westside")).toBe("Westside");
  });

  it("keeps the whole name when it shares one word of several, nothing, or is just the salon's name", () => {
    expect(locationLabel("Maple & Ash", "Downtown")).toBe("Downtown");
    expect(locationLabel("Maple & Ash Hair Studio", "Maple & Ash")).toBe("Maple & Ash");
    expect(locationLabel("Maple & Ash", "Maple Street")).toBe("Maple Street");
  });
});
