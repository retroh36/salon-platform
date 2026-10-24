// The shared front-desk iPad (migration …_shared_devices.sql): a device an
// owner or manager marked as shared carries a long random token in a
// cookie; only its sha256 is stored. Signed out, it shows the PIN screen
// (/switch) rather than the sign-in page.

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const DEVICE_COOKIE = "maestra_device";
// A year: the device stays shared until it's removed on Settings.
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const newDeviceToken = () => randomBytes(32).toString("base64url");
export const hashDeviceToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const isDeviceToken = (token: string | undefined): token is string => Boolean(token && /^[A-Za-z0-9_-]{43}$/.test(token));

// The hash of this device's token, if it has one.
export async function deviceTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  return isDeviceToken(token) ? hashDeviceToken(token) : null;
}
