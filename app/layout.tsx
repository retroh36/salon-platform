import type { Metadata, Viewport } from "next";
import { DemoBar } from "@/components/demo-bar";
import { BRAND_NAVY, siteUrl, TAGLINE } from "@/lib/branding";
import { isDemo } from "@/lib/demo";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

// Maestra's own brand: the browser tab, home-screen icon and link
// previews. Icons and the preview image are the files in this folder
// (favicon.ico, icon.svg, apple-icon.png, opengraph-image.png).
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Maestra", template: "%s · Maestra" },
  description: `Maestra runs your salon: the calendar, clients, stock and more, with Denise handling the back office. ${TAGLINE}`,
  applicationName: "Maestra",
  appleWebApp: { capable: true, title: "Maestra", statusBarStyle: "default" },
  openGraph: { type: "website", siteName: "Maestra", title: "Maestra", description: TAGLINE },
  twitter: { card: "summary_large_image", title: "Maestra", description: TAGLINE },
};

export const viewport: Viewport = { themeColor: BRAND_NAVY };

// The public demo (DEMO_MODE=true) has its bar on every page.
export default function RootLayout({ children }: LayoutProps<"/">) {
  const demo = isDemo();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`} data-demo={demo ? "" : undefined}>
      <body className="flex min-h-full flex-col font-sans">
        {demo && <DemoBar />}
        {children}
      </body>
    </html>
  );
}
