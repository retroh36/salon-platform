import { NextResponse } from "next/server";

// A failure in someone's browser (the error page reports it), logged like
// the server's own with the reference they were shown. Open to everyone,
// since clients' pages report too; small and text only.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const ref = text(body?.ref, 12);
  if (!ref || !/^E-[A-Z0-9]{6}$/.test(ref)) return new NextResponse(null, { status: 400 });
  console.error("[app:browser]", JSON.stringify({ ref, path: text(body?.path, 200)?.split("?")[0], name: text(body?.name, 80), message: text(body?.message, 300), stack: text(body?.stack, 600) }));
  return new NextResponse(null, { status: 204 });
}
