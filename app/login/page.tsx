import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Salon Platform" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm animate-fade-in rounded-xl border border-line bg-surface p-8 text-ink shadow-card">
        <span
          aria-hidden
          className="mb-6 inline-flex size-12 items-center justify-center rounded-[16px_5px_16px_5px] bg-plum-900 font-serif text-2xl text-white"
        >
          S
        </span>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-plum-900">Sign in</h1>
        <p className="mt-1 mb-6 text-sm text-ink-muted">Salon Platform</p>
        <LoginForm />
      </div>
    </main>
  );
}
