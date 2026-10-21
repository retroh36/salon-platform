import { describe, expect, it } from "vitest";
import { fullName, roleLabel, sortStaff } from "@/lib/staff";

const person = (
  first_name: string,
  role: "owner" | "manager" | "front_desk" | "stylist",
  is_active = true,
  last_name = "",
) => ({ first_name, last_name, role, is_active });

describe("fullName", () => {
  it("joins first and last name", () => {
    expect(fullName({ first_name: "Priya", last_name: "Shah" })).toBe("Priya Shah");
  });

  it("omits an empty last name", () => {
    expect(fullName({ first_name: "Cher", last_name: "" })).toBe("Cher");
  });
});

describe("roleLabel", () => {
  it("gives readable labels", () => {
    expect(roleLabel("front_desk")).toBe("Front desk");
    expect(roleLabel("owner")).toBe("Owner");
  });
});

describe("sortStaff", () => {
  it("orders by active, then role, then name", () => {
    const sorted = sortStaff([
      person("Zoe", "stylist"),
      person("Amy", "stylist", false),
      person("Sam", "front_desk"),
      person("Ben", "stylist"),
      person("Olivia", "owner"),
      person("Dan", "manager"),
    ]);

    expect(sorted.map((s) => s.first_name)).toEqual(["Olivia", "Dan", "Sam", "Ben", "Zoe", "Amy"]);
  });

  it("does not mutate the input", () => {
    const input = [person("B", "stylist"), person("A", "stylist")];
    sortStaff(input);
    expect(input.map((s) => s.first_name)).toEqual(["B", "A"]);
  });
});
