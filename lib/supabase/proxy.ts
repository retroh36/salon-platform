import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login"];
// Open to everyone, signed in or not: salons' booking sites, payment, card
// and opt-out links, the dev outbox (which shows nothing in production), and
// scheduled jobs (which check their own secret), and the link in invite and
// password reset emails (which signs them in), and the shared iPad's PIN
// screen (which checks the device itself).
const OPEN_PATHS = ["/book", "/dev/outbox", "/api/cron", "/unsubscribe", "/pay", "/card", "/auth/confirm", "/switch"];
// Set on a device marked as shared (lib/shared-device.ts).
const DEVICE_COOKIE = "maestra_device";

// Refreshes the auth session cookie on every request and sends signed-out
// users to /login (and signed-in users away from it).
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (OPEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
    return redirectWithCookies(request, response, "/dashboard");
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
