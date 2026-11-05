"use client";

import { useEffect } from "react";

// On the sign-in screens: whoever signs in next starts with Denise closed
// and a fresh conversation, so the session's open-or-closed memory (her
// calendar card's cookie, the card and chat kept in sessionStorage) goes.
export function ForgetDenise() {
  useEffect(() => {
    for (const c of document.cookie.split("; ")) {
      const name = c.split("=")[0];
      if (name.startsWith("calendar_denise_")) document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
    }
    try {
      for (const key of Object.keys(sessionStorage)) if (key.startsWith("maestra:denise")) sessionStorage.removeItem(key);
    } catch {
      // Storage blocked: nothing kept to forget.
    }
  }, []);
  return null;
}
