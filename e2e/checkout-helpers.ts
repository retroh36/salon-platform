import type { Page } from "@playwright/test";
import { expect, waitForHydration } from "./fixtures";

// The full-screen checkout (app/checkout/[id]): the ticket, payment, and
// its dialogs.

// Opens the checkout for a visit (or a new sale) at its own URL.
export async function openCheckout(page: Page, opts: { appointmentId?: string; productId?: string; from?: string } = {}) {
  const q = new URLSearchParams();
  if (opts.appointmentId) q.set("appointment", opts.appointmentId);
  if (opts.productId) q.set("product", opts.productId);
  q.set("from", opts.from ?? "/calendar");
  await page.goto(`/checkout/new?${q}`);
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await waitForHydration(page, "#product-search");
  return checkout(page);
}

// After "Check out client" from the calendar.
export async function onCheckout(page: Page) {
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  await waitForHydration(page, "#product-search");
  return checkout(page);
}

export function checkout(page: Page) {
  const ticket = page.getByRole("main", { name: "Ticket" });
  const payment = page.getByRole("complementary", { name: "Payment" });
  const dialog = page.getByRole("dialog");
  return {
    ticket,
    payment,
    dialog,
    total: payment.getByTestId("checkout-total"),
    remaining: payment.getByTestId("remaining"),
    lines: ticket.getByTestId("ticket-line"),
    // A line's editor, opened by tapping the line.
    // (`title` can be part of the line's name.)
    async edit(title: string) {
      await ticket.getByRole("button", { name: new RegExp(`^[^:]*${escape(title)}[^:]*: .*Edit$`) }).click();
      return ticket.getByRole("group", { name: new RegExp(`^Edit .*${escape(title)}`) });
    },
    async search(text: string) {
      await ticket.getByLabel("Add a product: name, brand, SKU or scan").fill(text);
    },
    async addProduct(text: string) {
      await ticket.getByLabel("Add a product: name, brand, SKU or scan").fill(text);
      await ticket.getByRole("list", { name: "Matching products" }).getByRole("button").first().click();
    },
    async card(dollars?: string) {
      await payment.getByRole("button", { name: "Card", exact: true }).click();
      if (dollars) await dialog.getByLabel("Amount ($)").fill(dollars);
      await dialog.getByRole("button", { name: /^Record .* card payment$/ }).click();
      await expect(dialog).toHaveCount(0);
    },
    // Cash on the number pad ("40" → $40), or the exact amount.
    async cash(dollars?: number) {
      await payment.getByRole("button", { name: "Cash", exact: true }).click();
      if (dollars === undefined) await dialog.getByRole("group", { name: "Quick amounts" }).getByRole("button").first().click();
      else for (const k of String(dollars * 100)) await dialog.getByRole("group", { name: "Number pad" }).getByRole("button", { name: k, exact: true }).click();
      await dialog.getByRole("button", { name: /^Record .* cash$/ }).click();
      await expect(dialog).toHaveCount(0);
    },
    async complete() {
      await payment.getByRole("button", { name: /^Complete sale/ }).click();
      const done = page.getByTestId("checkout-success");
      await expect(done).toBeVisible();
      return done;
    },
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
