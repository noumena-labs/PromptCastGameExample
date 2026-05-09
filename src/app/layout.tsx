import type { Metadata } from "next";
import { Cinzel, EB_Garamond, IM_Fell_English } from "next/font/google";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "600", "700", "900"], variable: "--font-display" });
const garamond = EB_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const fell = IM_Fell_English({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], variable: "--font-flavor" });

export const metadata: Metadata = {
  title: "PromptCast — Spellcasting in the Meadow",
  description: "A browser arena spellcaster powered by prompt-generated magic.",
};

// Lock the viewport against pinch-zoom and fit content under iPhone safe-area
// insets. `viewport-fit=cover` is what allows the `env(safe-area-inset-*)`
// CSS used by the touch overlay to actually report non-zero values.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
  themeColor: "#1a0f06",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cinzel.variable} ${garamond.variable} ${fell.variable}`}>
      {/*
        `suppressHydrationWarning` silences the React hydration mismatch
        triggered by browser extensions (Grammarly, LastPass, etc.) that
        inject attributes like `data-new-gr-c-s-check-loaded` onto <body>
        before React mounts. The mismatch is cosmetic and outside our control.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
