"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** Light/dark switch. A real <button role="switch"> for keyboard and a11y. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The saved theme lives in localStorage, so rendering it before mount
  // would cause a hydration mismatch. The placeholder reserves the space.
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        aria-hidden
        className="h-7 w-[3.25rem] rounded-full border border-rule bg-paper"
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative h-7 w-[3.25rem] shrink-0 rounded-full border border-rule bg-paper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <Sun className="pointer-events-none absolute left-[0.3rem] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
      <Moon className="pointer-events-none absolute right-[0.3rem] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />

      <span
        className={`absolute top-1/2 flex h-[1.375rem] w-[1.375rem] -translate-y-1/2 items-center justify-center rounded-full bg-surface shadow-md ring-1 ring-rule transition-transform duration-200 ease-out ${
          isDark ? "translate-x-[1.75rem]" : "translate-x-[0.125rem]"
        }`}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-[#A5B4FC]" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-[#F59E0B]" />
        )}
      </span>
    </button>
  );
}
