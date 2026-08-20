
import { HistorySync } from "@/components/HistorySync";
import { SessionTracker } from "@/components/SessionTracker";
import { SITE_URL } from "@/lib/site";
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
  // Absolute origin, without which every Open Graph image is ignored: scrapers
  // do not resolve relative URLs.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "cubeduel — a rating that actually means something",
    // Every page states what it is, then where it is.
    template: "%s · cubeduel",
  },
  description:
    "Speedcubing with server-verified solves. The server issues a scramble nobody has seen, replays your solve to prove it happened, and only then does it count. Plus phase analysis, a case trainer and duels.",
  applicationName: "cubeduel",
  keywords: [
    "speedcubing",
    "rubik's cube timer",
    "WCA scrambles",
    "CFOP analysis",
    "OLL PLL trainer",
    "cube solver",
  ],
  openGraph: {
    type: "website",
    siteName: "cubeduel",
    title: "cubeduel — a rating that actually means something",
    description:
      "Server-verified speedcubing. Every solve is replayed against the scramble it was issued for.",
    url: SITE_URL,
  },
  twitter: {
    // The large card, because the whole growth mechanic is a pasted link.
    card: "summary_large_image",
    title: "cubeduel — a rating that actually means something",
    description:
      "Server-verified speedcubing, phase analysis, a case trainer and duels.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  // The timer is a full-screen surface; letting it zoom on double-tap would fire
  // mid-solve on mobile.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // No provider. Identity is a cookie the server reads and an endpoint the
    // client asks once — see `useSession`. Nothing needs to wrap the tree, and
    // nothing about signing in ships JavaScript to somebody who never does.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Renders nothing; pushes local history to the account in the background. */}
        <HistorySync />
        {/* Renders nothing; counts one session per visit. Honours Do Not Track. */}
        <SessionTracker />
      </body>
    </html>
  );
}
