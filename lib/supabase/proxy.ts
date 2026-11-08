import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";
import { PATH_HEADER } from "@/lib/path-header";

const PUBLIC_PATHS = ["/login"];
// Open to everyone, signed in or not: salons' booking sites, payment, card
// and opt-out links, the dev outbox (which shows nothing in production but
// the demo), the demo's status (booleans only, and only in the demo), and
// scheduled jobs (which check their own secret), and the link in invite and
// password reset emails (which signs them in), and the shared iPad's PIN
// screen (which checks the device itself), and error reports from the
// error page (which log only).
const OPEN_PATHS = ["/book", "/b", "/api/client-error", "/dev/outbox", "/api/demo", "/api/cron", "/api/messages/inbound", "/api/messages/status", "/api/messages/email-events", "/api/payments/stripe", "/unsubscribe", "/pay", "/card", "/form", "/offer", "/finish", "/authorize", "/event", "/auth/confirm", "/switch"];
// Set on a device marked as shared (lib/shared-device.ts).
const DEVICE_COOKIE = "maestra_device";

// Refreshes the auth session cookie on every request and sends signed-out
// users to /login (and signed-in users away from it).
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (OPEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next({ request });

  // The path, for the server (getCurrentStaff keeps a bookkeeper to their
  // pages); always ours, never a browser's.
  const forwarded = new Headers(request.headers);
  forwarded.set(PATH_HEADER, path);
  let response = NextResponse.next({ request: { headers: forwarded } });
  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        forwarded.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({ request: { headers: forwarded } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Don't run code between createServerClient and getClaims: it validates
  // the token and triggers the cookie refresh above.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!isSignedIn && !isPublic) {
    // The shared iPad goes to its PIN screen, which falls back to sign-in.
    return redirectWithCookies(request, response, request.cookies.has(DEVICE_COOKIE) ? "/switch" : "/login");
  }
  if (isSignedIn && isPublic) {
    return redirectWithCookies(request, response, "/");
  }

  return response;
}

// A redirect must carry any refreshed session cookies, or the user is
// signed out on the next request.
function redirectWithCookies(request: NextRequest, from: NextResponse, pathname: string) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  const redirect = NextResponse.redirect(target);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(key);
    if (value) redirect.headers.set(key, value);
  }
  return redirect;
}
