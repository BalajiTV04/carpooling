import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { NavBar } from "@/components/NavBar";

// One sans + one mono, loaded through next/font (self-hosted, no render-block
// request to fonts.googleapis.com). CSS variables are mapped onto Tailwind's
// fontFamily in tailwind.config.ts: --font-body -> font-sans,
// --font-num -> font-mono (numbers: overlap %, km, rupee fares, distances).
const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body"
});
const num = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-num"
});

export const metadata: Metadata = {
  title: "VoltRide — Route-Aware Private Vehicle Sharing",
  description:
    "AI route-aware vehicle sharing: match on real route overlap, pick the minimum-detour pickup point, split the fare per leg, and track the ride live.",
  keywords: [
    "vehicle sharing", "ride sharing", "route matching", "carpooling",
    "minimum detour pickup", "AI matching", "Karnataka", "Bengaluru"
  ],
  openGraph: {
    title: "VoltRide — Route-Aware Private Vehicle Sharing",
    description:
      "Match riders to drivers on the same corridor. Every recommendation is explainable.",
    type: "website"
  }
};

// Dark-first shell: <html class="dark"> locks Direction B night theme.
// SessionProvider (Module 3) makes login state available on every page.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${body.variable} ${num.variable}`}>
      <body className="min-h-screen antialiased">
        <SessionProvider>
          <NavBar />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
