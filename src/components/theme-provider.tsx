"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Isolated so the root layout can stay a server component. next-themes needs
 * browser APIs and React context, so it has to run on the client.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      // Off deliberately: following the OS setting would flip existing users.
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
