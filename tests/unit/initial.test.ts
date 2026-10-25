// Initials and short names from names with emoji and accents: whole
// characters, never half an emoji (a broken character on screen).
import { describe, expect, it } from "vitest";
import { nameVariants } from "@/lib/calendar-views";
import { initials } from "@/components/ui/avatar";
import { firstLetter } from "@/lib/initial";

describe("first letters", () => {
  it("keep emoji and accented letters whole", () => {
    expect(firstLetter("😀 Smith")).toBe("😀");
    expect(firstLetter("👩‍👩‍👧 Family")).toBe("👩‍👩‍👧");
    expect(firstLetter("Émile")).toBe("É");
    expect(firstLetter("  ")).toBe("");
  });

  it("make initials and short names that read right", () => {
    expect(initials("Zoë 🌸")).toBe("Z🌸");
    expect(initials("🌸 Lee")).toBe("🌸L");
    expect(nameVariants("Ana 🌸", "Ana", true)).toEqual(["Ana 🌸", "Ana 🌸.", "Ana", "A🌸"]);
    expect(nameVariants("Bridget Callahan", "Bridget", true)).toEqual(["Bridget Callahan", "Bridget C.", "Bridget", "BC"]);
  });
});
