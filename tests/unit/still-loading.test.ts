import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELOAD_LOAD_MS, SLOW_LOAD_MS, watchLoading } from "@/components/still-loading";
import { hasUnsavedWork, resetUnsavedWork, setUnsaved, trackSave } from "@/lib/unsaved-work";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a page that stalls while loading", () => {
  it("says so at 10 seconds, reloads at 20, and only once while it keeps stalling", () => {
    const storage = memory();
    const on = { slow: vi.fn(), reload: vi.fn() };
    watchLoading("/clients", storage, on);
    vi.advanceTimersByTime(SLOW_LOAD_MS - 1);
    expect(on.slow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(on.slow).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(RELOAD_LOAD_MS - SLOW_LOAD_MS);
    expect(on.reload).toHaveBeenCalledOnce();
    // After the reload it stalls again: Reload is offered, no second reload.
    const again = { slow: vi.fn(), reload: vi.fn() };
    watchLoading("/clients", storage, again);
    vi.advanceTimersByTime(RELOAD_LOAD_MS);
    expect(again.slow).toHaveBeenCalledOnce();
    expect(again.reload).not.toHaveBeenCalled();
  });

  it("does nothing once the page has come, and a later stall may reload again", () => {
    const storage = memory();
    const on = { slow: vi.fn(), reload: vi.fn() };
    const first = watchLoading("/clients", storage, on);
    vi.advanceTimersByTime(RELOAD_LOAD_MS);
    first.stop();
    first.loaded();
    const later = { slow: vi.fn(), reload: vi.fn() };
    const watch = watchLoading("/clients", storage, later);
    vi.advanceTimersByTime(SLOW_LOAD_MS / 2);
    watch.stop();
    vi.advanceTimersByTime(RELOAD_LOAD_MS);
    expect(later.slow).not.toHaveBeenCalled();
    const stalled = { slow: vi.fn(), reload: vi.fn() };
    watchLoading("/clients", storage, stalled);
    vi.advanceTimersByTime(RELOAD_LOAD_MS);
    expect(stalled.reload).toHaveBeenCalledOnce();
  });

  it("never reloads by itself over unsaved work: Reload is offered instead", () => {
    resetUnsavedWork();
    setUnsaved("checkout:1", true);
    const on = { slow: vi.fn(), reload: vi.fn(), unsaved: hasUnsavedWork };
    watchLoading("/checkout/1", memory(), on);
    vi.advanceTimersByTime(RELOAD_LOAD_MS);
    expect(on.slow).toHaveBeenCalledOnce();
    expect(on.reload).not.toHaveBeenCalled();
    resetUnsavedWork();
  });

  it("counts a change as unsaved until it's saved, and a save on its way too", async () => {
    resetUnsavedWork();
    expect(hasUnsavedWork()).toBe(false);
    setUnsaved("notes:a", true);
    expect(hasUnsavedWork()).toBe(true);
    setUnsaved("notes:a", false);
    let finish!: () => void;
    const save = trackSave(new Promise<void>((r) => (finish = r)));
    expect(hasUnsavedWork()).toBe(true);
    finish();
    await save;
    await Promise.resolve();
    expect(hasUnsavedWork()).toBe(false);
  });

  it("never reloads without storage to remember it by (no loop)", () => {
    const on = { slow: vi.fn(), reload: vi.fn() };
    watchLoading("/clients", null, on);
    vi.advanceTimersByTime(RELOAD_LOAD_MS);
    expect(on.slow).toHaveBeenCalledOnce();
    expect(on.reload).not.toHaveBeenCalled();
  });
});
