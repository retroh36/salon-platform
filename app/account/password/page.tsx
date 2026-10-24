import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "@/app/login/auth-screen";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Choose a password" };

// After an invite or a reset link: choose the password to sign in with.
export default function PasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  return (
    <Suspense fallback={null}>
      <Password searchParams={searchParams} />
    </Suspense>
  );
}

async function Password({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  return (
    <AuthScreen
      title={welcome ? "Welcome to Maestra" : "Choose a new password"}
      subtitle={welcome ? "Choose a password to sign in to your salon with." : "Choose the password you'll sign in with from now on."}
    >
      <PasswordForm />
    </AuthScreen>
  );
}
