import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "AllerGeez", description: "Your food & reaction buddy" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fbf7f3" };

export default function Root({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates
  return (<html lang="en"><body suppressHydrationWarning>{children}</body></html>);
}
