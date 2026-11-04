import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

// The finished-look check: on the page as it is, no text is cut off by a box
// that hides overflow, spills out of its own box, or sits under another
// element, and the page never scrolls sideways. Text shortened on purpose
// ("…" or a line clamp) counts as whole; so does text scrolled out of view
// inside a scroller, or under something fixed or sticky (a sheet, Denise's
// card, the calendar's sticky header) or a side-scrolling row's arrow,
// since those are meant to cover what scrolls beneath them.
export async function expectTidyLayout(page: Page, where: string) {
  await page.mouse.move(0, 0);
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const doc = document.scrollingElement!;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`the page scrolls sideways (${doc.scrollWidth} in ${doc.clientWidth})`);

    const hidden = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return true;
      }
      return false;
    };
    // Screen-reader-only text is clipped on purpose.
    const srOnly = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return true;
      }
      return false;
    };
    const shortened = (el: Element) => {
      const s = getComputedStyle(el);
      return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
    };
    // Covers on top of everything by design: fixed or sticky, and what's inside them.
    const overlay = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const p = getComputedStyle(e).position;
        if (p === "fixed" || p === "sticky") return true;
        // Denise's previews, tooltips, and the arrow at a side-scrolling row's faded edge.
        if (e.matches("[data-fix-ghost],[role=tooltip],[data-side-arrow]")) return true;
      }
      return false;
    };
    const name = (el: Element) => `"${(el.textContent ?? "").trim().slice(0, 40)}"`;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent?.trim()) continue;
      seen.add(el);
      if (el.closest("script,style,noscript,svg,textarea,select,option") || hidden(el) || srOnly(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!lines.length) continue;
      const text = range.getBoundingClientRect();
      const own = shortened(el);

      // Spilling out of its own box (a block that doesn't wrap, or a word too long).
      const box = el.getBoundingClientRect();
      if (getComputedStyle(el).display !== "inline" && !own && (text.right > box.right + 1 || text.left < box.left - 1)) {
        out.push(`${name(el)} spills out of its box (${text.width.toFixed(0)} in ${box.width.toFixed(0)})`);
        continue;
      }

      // Cut off by an ancestor that hides overflow, or out of a scroller's view.
      let clipped = false;
      let view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      for (let e: Element | null = own ? el.parentElement : el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        // Nothing above a fixed box (a sheet drawn into the page's main)
        // clips it.
        if (s.overflowX === "visible" && s.overflowY === "visible") {
          if (s.position === "fixed") break;
          continue;
        }
        const r = e.getBoundingClientRect();
        const scrolls = /auto|scroll/.test(s.overflowX + s.overflowY);
        if (scrolls) {
          view = { left: Math.max(view.left, r.left), top: Math.max(view.top, r.top), right: Math.min(view.right, r.right), bottom: Math.min(view.bottom, r.bottom) };
          // Running past a scroller's edge is scrolled, not cut: the boxes
          // further out are no narrower than the scroller's view.
          if (text.right > view.right + 1 || text.left < view.left - 1 || text.bottom > view.bottom + 1 || text.top < view.top - 1) break;
          continue;
        }
        if (shortened(e)) break;
        const inView = text.right > view.left && text.left < view.right && text.bottom > view.top && text.top < view.bottom;
        if (inView && (text.right > r.right + 1 || text.left < r.left - 1 || text.bottom > r.bottom + 1 || text.top < r.top - 1)) {
          out.push(`${name(el)} is cut off`);
          clipped = true;
          break;
        }
        if (s.position === "fixed") break;
      }
      if (clipped) continue;

      // Covered by another element (checked at the middle of each line).
      if (overlay(el)) continue;
      for (const line of lines) {
        const x = line.left + line.width / 2;
        const y = line.top + line.height / 2;
        if (x < view.left || x > view.right || y < view.top || y > view.bottom || x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el) || overlay(hit)) continue;
        out.push(`${name(el)} is covered by <${hit.tagName.toLowerCase()} class="${hit.getAttribute("class")?.slice(0, 60) ?? ""}">`);
        break;
      }
    }
    return out;
  });
  expect(problems, `layout problems ${where}`).toEqual([]);
}

// The calendar's column headers, whole: each stylist's name, hours and day
// read in one of their own forms ("Bridget Callahan", "Bridget C."), never
// cut mid-word with "…"; the day keeps its label ("6 visits", not "6"). The
// name has all the room beside the photo, and is shortened only when the
// full name doesn't fit there.
export async function expectWholeHeaders(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const cut = (el: Element | null) => !!el && (el.scrollWidth > el.clientWidth + 0.5 || (el.textContent ?? "").includes("…"));
    for (const header of document.querySelectorAll<HTMLElement>("main [data-column-header]")) {
      if (!header.offsetParent) continue;
      const nameBox = header.querySelector<HTMLElement>("[data-column-name]");
      const name = nameBox?.title ?? "";
      const shown = (nameBox?.textContent ?? "").trim();
      const fits = nameBox?.querySelector("span") ?? nameBox;
      if (cut(fits)) out.push(`${name}: the name is cut ("${shown}")`);
      else if (nameBox && shown !== name) {
        // Shortened: only when the full name needs more room than there is.
        const probe = document.createElement("span");
        probe.textContent = name;
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(fits!).font}`;
        document.body.append(probe);
        const needs = probe.getBoundingClientRect().width;
        probe.remove();
        if (needs <= nameBox.getBoundingClientRect().width) out.push(`${name}: shows "${shown}" though the full name fits`);
      }
      // The name's room: the header less its padding, the photo and the gap.
      const row = nameBox?.closest("[data-column-header] > div");
      const photo = row?.firstElementChild;
      if (nameBox && row && photo && !photo.contains(nameBox)) {
        const room = row.getBoundingClientRect().width - photo.getBoundingClientRect().width - parseFloat(getComputedStyle(row).columnGap || "0");
        if (nameBox.getBoundingClientRect().width < room - 1) out.push(`${name}: the name has ${nameBox.getBoundingClientRect().width.toFixed(0)}px of ${room.toFixed(0)}px beside the photo`);
      }
      const hours = header.querySelector<HTMLElement>("[data-testid=column-hours]");
      if (hours && (cut(hours.querySelector("span") ?? hours) || cut(hours))) out.push(`${name}: the hours are cut ("${hours.textContent}")`);
      const day = header.querySelector<HTMLElement>("[data-testid=booked-summary]");
      if (day) {
        const text = (day.textContent ?? "").trim();
        if (cut(day.querySelector("span") ?? day) || cut(day)) out.push(`${name}: the day is cut ("${text}")`);
        else if (!/^(\d+ visits?\b|No bookings)/.test(text)) out.push(`${name}: the day has no label ("${text}")`);
      }
    }
    return out;
  });
  expect(problems, `column headers ${where}`).toEqual([]);
}
