import type { Metadata } from "next";
import Link from "next/link";
import { AuthScreen } from "../auth-screen";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <AuthScreen
      title="Forgot your password?"
      subtitle="Enter the email you sign in with, and we'll send a link to choose a new one."
      footer={
        <p className="mt-10 text-sm">
          <Link href="/login" className="font-medium text-link underline underline-offset-2 hover:text-link-hover">
            Back to sign in
          </Link>
        </p>
      }
    >
      <ForgotForm />
    </AuthScreen>
  );
}
