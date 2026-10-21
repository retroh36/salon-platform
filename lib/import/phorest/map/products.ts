import type { IssueLog } from "../issues.ts";
import type { GiftCardRecord, ProductRecord } from "../model.ts";
import type { PhorestProduct, PhorestVoucher } from "../types.ts";
import { cents, isoDateTime, text } from "./common.ts";

export function mapProduct(p: PhorestProduct, locationExternalId: string, log: IssueLog): ProductRecord | null {
  const externalId = text(p.productId);
  const name = text(p.name);
  if (!externalId || !name) {
    log.add("product", externalId ? "name" : "productId", "skipped", "missing");
    return null;
  }

  const rawType = (text(p.type) ?? "").toLowerCase();
  let type: ProductRecord["type"] = "retail";
  if (/prof|back|salon|internal|consum/.test(rawType)) type = "back_bar";
  else if (!/retail/.test(rawType)) log.add("product", "type", "review", "unrecognized type; imported as retail");

  let price = cents(p.price);
  if (price === null || price < 0) {
    log.add("product", "price", "adjusted", "missing or negative; set to 0");
    price = 0;
  }
  const onHand = typeof p.quantityInStock === "number" && Number.isFinite(p.quantityInStock) ? p.quantityInStock : 0;
  if (onHand < 0) log.add("product", "quantityInStock", "review", "negative stock");

  return {
    externalId,
    locationExternalId,
    name,
    brand: text(p.brandName),
    category: text(p.categoryName),
    sku: text(p.code),
    barcode: text(p.barcode),
    type,
    price_cents: price,
    cost_cents: cents(p.reorderCost),
    on_hand: onHand,
    reorder_point: typeof p.minQuantity === "number" ? p.minQuantity : null,
    archived: p.archived === true,
  };
}

export function mapVoucher(v: PhorestVoucher, clientIds: Set<string>, log: IssueLog): GiftCardRecord | null {
  const externalId = text(v.voucherId);
  const serial = text(v.serialNumber);
  if (!externalId || !serial) {
    log.add("gift_card", externalId ? "serialNumber" : "voucherId", "skipped", "missing");
    return null;
  }
  const original = cents(v.originalBalance);
  const remaining = cents(v.remainingBalance);
  if (original === null || remaining === null || original < 0 || remaining < 0) {
    log.add("gift_card", "originalBalance/remainingBalance", "skipped", "missing or negative balance");
    return null;
  }
  if (remaining > original) log.add("gift_card", "remainingBalance", "review", "more than the original balance");

  const clientId = text(v.clientId);
  if (clientId && !clientIds.has(clientId)) log.add("gift_card", "clientId", "dropped", "client not imported");

  return {
    externalId,
    serial,
    clientExternalId: clientId && clientIds.has(clientId) ? clientId : null,
    issued_at: isoDateTime(v.issueDate),
    expires_at: isoDateTime(v.expiryDate),
    original_cents: original,
    remaining_cents: remaining,
  };
}
