import type { PatchState } from "@/lib/scheduling/patch-tests";
import type { BookingSite } from "./site";

// Why a service that needs a patch test can't be booked online, and how to
// get one. (Online, a missing or out-of-date patch test always blocks.)
export function patchExplanation(site: BookingSite, state: Exclude<PatchState, "ok">): string {
  const call = site.location.phone ? `Call us on ${site.location.phone}` : "Call the salon";
  const hours = site.patchTest.minHours;
  const months = Math.round(site.patchTest.validDays / 30.4);
  switch (state) {
    case "missing":
      return `Color services need a patch test at least ${hours} hours before your visit, and we don't have one on file for you. ${call} to book a quick patch test, then book online.`;
    case "expired":
      return `Color services need a patch test from the last ${months} months, and yours is older. ${call} to book a quick patch test, then book online.`;
    case "too_recent":
      return `Your patch test needs to be at least ${hours} hours before your visit. Please pick a later day.`;
    case "reaction":
      return `Your last patch test showed a reaction, so we'd like to talk it through first. ${call}.`;
  }
}
