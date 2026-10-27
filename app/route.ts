import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { homeFor } from "@/lib/staff";

// "/": the calendar, or My day for stylists and assistants (homeFor). Every
// sign-in lands here, and so does the logo. Signed out, getCurrentStaff
// sends them to /login; a login not linked to a salon gets the calendar's
// "not linked" message.
export async function GET(request: Request) {
  const { staff } = await getCurrentStaff();
  return NextResponse.redirect(new URL(staff ? homeFor(staff.role) : "/calendar", request.url));
}
