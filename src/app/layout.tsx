import { ClerkProvider } from "@clerk/nextjs";

import { HistorySync } from "@/components/HistorySync";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cubeduel — speedcubing timer",
  description:
    "A speedcubing timer with WCA scrambles, a shared daily scramble, and head-to-head duels.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  // The timer is a full-screen surface; letting it zoom on double-tap would fire
  // mid-solve on mobile.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Clerk's own UI is themed to match the app rather than dropped in as-is; a
    // stock white modal on a near-black page reads as a third-party bolt-on.
    <ClerkProvider
      appearance={{
        variables: {
          colorBackground: "#141417",
          colorForeground: "#f2f2f3",
          colorMutedForeground: "#8a8a95",
          colorInput: "#1c1c21",
          colorInputForeground: "#f2f2f3",
          colorPrimary: "#f2f2f3",
          colorPrimaryForeground: "#0a0a0b",
          colorNeutral: "#8a8a95",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          {children}
          {/* Renders nothing; pushes local history to the account in the background. */}
          <HistorySync />
        </body>
      </html>
    </ClerkProvider>
  );
}
