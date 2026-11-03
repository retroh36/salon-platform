import { Source_Serif_4 } from "next/font/google";

// Source Serif, only on the pages clients see (the booking site, its
// account and manage pages, and the pay, card, event and unsubscribe links)
// and on signing in: for the salon's name and big headlines (`font-serif`).
// The staff app stays Geist (docs/brand.md, "Typography"). Loaded through
// next/font, which fetches it once at build and serves it from the app; a
// page has it only when something on it adds `serif.variable`.
export const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });
