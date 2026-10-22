import type { MetadataRoute } from "next";
import { BRAND_NAVY, TAGLINE } from "@/lib/branding";

// So Maestra can be added to an iPad (or phone) home screen with its icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Maestra",
    short_name: "Maestra",
    description: TAGLINE,
    start_url: "/calendar",
    display: "standalone",
    background_color: "#fbf8f5",
    theme_color: BRAND_NAVY,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
