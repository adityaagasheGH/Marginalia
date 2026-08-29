import type { Metadata } from "next";
import { Inter, DM_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/**
 * Fonts:
 *   Inter    — body / UI. "Boring on purpose; it disappears."
 *   DM Sans  — display / headings (was Instrument Serif,
 *              swapped to DM Sans on request).
 *   JetBrains Mono — page refs, tokens, citation chips.
 *
 * next/font self-hosts these at build time — no runtime request to Google,
 * which keeps them working under the strict CSP we add later.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-serif",
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
    // The `dark` class is no longer hardcoded here — ThemeProvider now puts
    // it on <html> (and takes it off) from the user's saved preference. The
    // default is still dark, so the app looks unchanged until the toggle in
    // the dashboard header is used.
    //
    // suppressHydrationWarning is required by next-themes and only by this
    // element: the library sets the class in a blocking script before React
    // hydrates, to avoid a flash of the wrong theme. That means the server's
    // <html> and the client's briefly differ, which React would otherwise
    // report as a mismatch. It suppresses the warning for this tag alone,
    // not for the tree beneath it.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">
        <ThemeProvider>
          {children}
          {/* Toaster renders the sonner toasts triggered anywhere in the app. */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
