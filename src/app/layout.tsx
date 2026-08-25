import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Fonts, per docs/UI_SPEC.md:
 *   Inter            — body / UI. "Boring on purpose; it disappears."
 *   Instrument Serif — display / headings. Signals "document" instantly.
 *   JetBrains Mono   — page refs, tokens, citation chips.
 *
 * next/font self-hosts these at build time — no runtime request to Google,
 * which keeps them working under the strict CSP we add later.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marginalia — Read it. Ask it. Argue about it.",
  description:
    "Upload a PDF, get an AI summary, ask it questions, and comment in the margins.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables go on <html>, not <body>: globals.css applies
    // `font-sans` at the html level, and a custom property defined only on
    // body would be undefined there — the font would silently fall back to
    // the browser's default serif.
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">
        {children}
        {/* Toaster renders the sonner toasts triggered anywhere in the app. */}
        <Toaster />
      </body>
    </html>
  );
}
