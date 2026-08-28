"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Wraps next-themes so the root layout can stay a server component.
 *
 * next-themes needs browser APIs (localStorage, matchMedia) and React
 * context, so it must run on the client. Keeping it in this one small file
 * means layout.tsx does not need "use client" — which would otherwise push
 * the entire app tree onto the client.
 *
 * What the library actually does: it reads the saved preference before the
 * page paints and puts `class="dark"` (or removes it) on <html>. globals.css
 * already defines both palettes — `:root` for light, `.dark` for dark — so
 * every colour in the app follows from that one class.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      // Toggle a class, not a data attribute — globals.css targets `.dark`.
      attribute="class"
      // The app has always shipped dark; keep that for anyone who has never
      // touched the toggle, so this feature changes nothing until it is used.
      defaultTheme="dark"
      // Deliberately off: following the OS setting would flip existing users
      // to light on their next visit, which is a behaviour change nobody
      // asked for. The toggle is an explicit choice.
      enableSystem={false}
      // Without this, every colour transition in the app animates at once
      // during a switch, which reads as a slow smear rather than a flip.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
