import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PromptCast",
  description: "A browser arena spellcaster powered by prompt-generated magic.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
