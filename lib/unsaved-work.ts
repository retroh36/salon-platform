// Whether anything on this page could be lost by reloading it: a form with
// changes (`useUnsavedChanges`), typing not yet saved (checkout, notes,
// Denise's message box), or a save still on its way to the server. The
// loading screen reloads a stalled page by itself only when there's none
// (components/still-loading.tsx); otherwise it offers Reload.

const dirty = new Set<string>();
let saving = 0;

export function setUnsaved(key: string, unsaved: boolean) {
  if (unsaved) dirty.add(key);
  else dirty.delete(key);
}

// Counts a save while it's on its way; returns it unchanged.
export function trackSave<T>(save: Promise<T>): Promise<T> {
  saving++;
  const done = () => {
    saving--;
  };
  save.then(done, done);
  return save;
}

export function hasUnsavedWork(): boolean {
  return dirty.size > 0 || saving > 0;
}

// For tests.
export function resetUnsavedWork() {
  dirty.clear();
  saving = 0;
}
