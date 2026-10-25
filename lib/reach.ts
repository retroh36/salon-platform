// A server action from the browser that never got an answer (offline, the
// Wi-Fi dropped): a plain message instead of a crash. It may have gone
// through before the connection went, so it says to look before trying
// again. An error the server threw (it has a digest) still goes to the
// error page, with its reference.

export const NO_CONNECTION = "We couldn't reach the server, so we don't know if that went through. Check the connection, then check the calendar before trying again.";

export async function reach<T>(action: Promise<T>): Promise<T | { ok: false; message: string }> {
  try {
    return await action;
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
    return { ok: false, message: NO_CONNECTION };
  }
}
