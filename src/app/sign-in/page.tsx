import type { Metadata } from "next";

import { SignInScreen } from "@/components/SignInScreen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · cubeduel",
  description: "Sign in with a passkey, or with an email and password.",
};

export default function SignInPage() {
  return <SignInScreen />;
}
