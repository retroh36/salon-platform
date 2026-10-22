import type { Metadata, Viewport } from "next";
import { BRAND_NAVY, siteUrl, TAGLINE } from "@/lib/branding";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Body text and headings; see the design tokens in globals.css.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
