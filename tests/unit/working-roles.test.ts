import { describe, expect, it } from "vitest";
import { payProblem, payText, roleProblem, servicesText } from "@/lib/working-roles";

describe("working roles", () => {
  it("need a name of their own", () => {
    expect(roleProblem({ name: "  ", online: true, serviceIds: [] }, [])).toBe("Give the role a name.");
    expect(roleProblem({ name: "Wash House", online: true, serviceIds: [] }, [{ name: "wash house " }])).toBe("There's already a role called Wash House.");
    expect(roleProblem({ name: "Beauty Bar", online: true, serviceIds: [] }, [{ name: "Wash House" }])).toBeNull();
  });

  it("need a rate for hourly and a percent for commission", () => {
    expect(payProblem({ method: "usual", hourlyRateCents: null, commissionPct: null })).toBeNull();
    expect(payProblem({ method: "hourly", hourlyRateCents: null, commissionPct: null })).toBe("Give an hourly rate up to $1,000.");
    expect(payProblem({ method: "commission", hourlyRateCents: null, commissionPct: 120 })).toBe("Give a commission between 0 and 100%.");
    expect(payProblem({ method: "commission", hourlyRateCents: null, commissionPct: 40 })).toBeNull();
  });

  it("say their pay and services in a few words", () => {
    expect(payText({ method: "hourly", hourlyRateCents: 1850, commissionPct: null })).toBe("Hourly · $18.50");
    expect(payText({ method: "commission", hourlyRateCents: null, commissionPct: 40 })).toBe("Commission · 40%");
    expect(payText({ method: "usual", hourlyRateCents: null, commissionPct: null })).toBe("Their usual pay");
    const names = new Map([["a", "Blowout"], ["b", "Deep Conditioning"], ["c", "Gloss"]]);
    expect(servicesText([], names)).toBe("All their services");
    expect(servicesText(["a", "b"], names)).toBe("Blowout and Deep Conditioning");
    expect(servicesText(["a", "b", "c"], names)).toBe("3 services");
  });
});
