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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cinzel.variable} ${garamond.variable} ${fell.variable}`}>
      <body>{children}</body>
    </html>
  );
}
