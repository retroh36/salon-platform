import type { IssueLog } from "../issues.ts";
import type { ClientRecord } from "../model.ts";
import type { PhorestClient } from "../types.ts";
import { email, isoDateTime, phone, text } from "./common.ts";

export function mapClient(c: PhorestClient, staffIds: Set<string>, log: IssueLog): ClientRecord | null {
  const externalId = text(c.clientId);
  if (!externalId) {
    log.add("client", "clientId", "skipped", "missing");
    return null;
  }
  if (c.deleted) {
    log.add("client", "deleted", "skipped", "deleted in Phorest");
    return null;
  }
  if (text(c.mergedToClientId)) {
    log.add("client", "mergedToClientId", "skipped", "merged into another client");
    return null;
  }

  let first = text(c.firstName);
  let last = text(c.lastName) ?? "";
  if (!first) {
    if (!last) {
      log.add("client", "firstName", "skipped", "no first or last name");
      return null;
    }
    log.add("client", "firstName", "adjusted", "missing; used the last name");
    [first, last] = [last, ""];
  }

  const preferred = text(c.preferredStaffId);
  if (preferred && !staffIds.has(preferred)) log.add("client", "preferredStaffId", "dropped", "staff member not imported");

  // Fields with no home yet (reported so nothing is lost silently).
  if (text(c.birthDate)) log.add("client", "birthDate", "dropped", "not supported yet");
  if (c.address && Object.values(c.address).some((v) => text(v))) log.add("client", "address", "dropped", "not supported yet");
  if (c.banned) log.add("client", "banned", "dropped", "not supported yet");
  if (c.archived) log.add("client", "archived", "review", "archived in Phorest; imported as a normal client");
  if (c.creditAccount?.outstandingBalance) log.add("client", "creditAccount", "dropped", "account balances come in a later phase");
  if (c.loyaltyCard?.points) log.add("client", "loyaltyCard", "dropped", "loyalty comes in a later phase");

  return {
    externalId,
    first_name: first,
    last_name: last,
    email: email(c.email, log, "client"),
    phone: phone(text(c.mobile) ?? c.landLine, log, "client"),
    preferredStaffExternalId: preferred && staffIds.has(preferred) ? preferred : null,
    notes: text(c.notes),
    sms_opt_in: c.smsMarketingConsent === true,
    email_opt_in: c.emailMarketingConsent === true,
    created_at: isoDateTime(c.clientSince) ?? isoDateTime(c.createdAt),
  };
}
