"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Light/dark switch: a pill track with a sliding knob.
 *
 * Both icons sit on the track, dimmed. The white knob slides over whichever
 * one is active and carries a coloured copy of it — so the current mode is
 * readable at a glance, not just inferred from the knob's position.
 *
 * Built as a <button role="switch"> rather than a styled checkbox: it is a
 * two-state control, and `role="switch"` + `aria-checked` is what tells a
 * screen reader that. Keyboard support (Enter/Space, focus ring) comes free
 * from using a real button.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  /**
   * The server has no way to know the visitor's saved theme — it lives in
   * their browser's localStorage. Rendering the real state immediately would
   * mean the server guesses one thing, the client renders another, and React
   * reports a hydration mismatch. Waiting for mount avoids that; the
   * placeholder below reserves the exact same space so nothing shifts.
   */
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
      {/* Track icons, dimmed. The knob covers whichever one is active. */}
      <Sun className="pointer-events-none absolute left-[0.3rem] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
      <Moon className="pointer-events-none absolute right-[0.3rem] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />

      {/* The sliding knob. translate-x moves it; the icon inside swaps. */}
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
