import type { Metadata } from "next";

import { ForgotScreen } from "@/components/ForgotScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Forgot your password · cubeduel",
  description: "Get a link to set a new password.",
  robots: { index: false, follow: false },
};

export default function ForgotPage() {
  return <ForgotScreen />;
}
