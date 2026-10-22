import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm animate-fade-in rounded-xl border border-line bg-surface p-8 text-ink shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/maestra/maestra-mark.svg" alt="Maestra" className="mb-6 h-10 w-auto" />
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-navy-900">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-ink-muted">Maestra</p>
        <LoginForm />
      </div>
    </main>
  );
}
