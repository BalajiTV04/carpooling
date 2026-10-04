import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { NavBar } from "@/components/NavBar";

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
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@500;600;700;800&family=JetBrains+Mono:wght@500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <SessionProvider>
          <NavBar />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
