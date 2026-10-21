import type { IssueLog } from "../issues.ts";
import type { LocationRecord } from "../model.ts";
import type { PhorestBranch } from "../types.ts";
import { isValidTimeZone, text } from "./common.ts";

export function mapBranch(b: PhorestBranch, log: IssueLog): LocationRecord | null {
  const externalId = text(b.branchId);
  const name = text(b.name);
  const timezone = text(b.timeZone);
  if (!externalId) {
    log.add("location", "branchId", "skipped", "missing");
    return null;
  }
  if (!name) {
    log.add("location", "name", "skipped", "missing");
    return null;
  }
  if (!timezone || !isValidTimeZone(timezone)) {
    log.add("location", "timeZone", "skipped", timezone ? "not a recognized timezone" : "missing");
    return null;
  }

  let country = text(b.country)?.toUpperCase() ?? "US";
  if (!/^[A-Z]{2}$/.test(country)) {
    log.add("location", "country", "adjusted", "not a 2-letter country code; set to US");
    country = "US";
  }

  return {
    externalId,
    name,
    address_line1: text(b.streetAddress1),
    address_line2: text(b.streetAddress2),
    city: text(b.city),
    region: text(b.state),
    postal_code: text(b.postalCode),
    country,
    timezone,
  };
}
