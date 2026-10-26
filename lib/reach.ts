// A server action from the browser that never got an answer (offline, the
// Wi-Fi dropped): a plain message instead of a crash. It may have gone
// through before the connection went, so it says to look before trying
// again. An error the server threw (it has a digest) still goes to the
// error page, with its reference.

export const NO_CONNECTION = "We couldn't reach the server, so we don't know if that went through. Check the connection, then check the calendar before trying again.";

// For a client paying or saving a card on their phone: sent again, a link
// that already went through says so, and every charge has its own
// idempotency key, so trying again never charges twice.
export const CLIENT_NO_CONNECTION = "We couldn't reach the salon. Check your connection and try again: you won't be charged twice.";

export async function reach<T>(action: Promise<T>, message = NO_CONNECTION): Promise<T | { ok: false; message: string }> {
  try {
    return await action;
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
    return { ok: false, message };
  }
}
