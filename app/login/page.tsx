import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Salon Platform" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-neutral-500">Salon Platform</p>
        <LoginForm />
      </div>
    </main>
  );
}
