import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/page";
import { AuthScreen } from "./auth-screen";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const NOTES: Record<string, { tone: "error"; text: string }> = {
  expired: { tone: "error", text: "That link has expired or was already used. Ask for a new one below." },
};

// Why they're here, if a link sent them (an expired one).
async function LinkNote({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  const note = link ? NOTES[link] : null;
  return note ? (
    <Alert tone={note.tone} className="mb-4">
      {note.text}
    </Alert>
  ) : null;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  return (
    <AuthScreen
      title="Sign in"
      subtitle="Welcome back. Sign in to your salon."
      footer={<p className="mt-10 text-xs text-ink-subtle">Trouble signing in? Ask your salon&rsquo;s owner to check your account.</p>}
    >
      <Suspense fallback={null}>
        <LinkNote searchParams={searchParams} />
      </Suspense>
      <LoginForm />
      <p className="mt-4 text-sm">
        <Link href="/login/forgot" className="font-medium text-link underline underline-offset-2 hover:text-link-hover">
          Forgot password?
        </Link>
      </p>
    </AuthScreen>
  );
}
