"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark theme toggle. Defaults to the OS preference; an explicit choice is
 * persisted to localStorage and applied by toggling `.dark` on <html>. The
 * no-flash initial class is set by an inline script in the root layout, so this
 * component only needs to reflect + flip the current state after hydration.
 */
type Mode = "light" | "dark";

function currentMode(): Mode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(currentMode());
    setMounted(true);
  }, []);

  // Keep in sync with the OS only while the user hasn't made an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (localStorage.getItem("theme")) return; // explicit choice wins
      const next: Mode = mq.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      setMode(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Mode = mode === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode */
    }
    setMode(next);
  }

  // Avoid a hydration mismatch: render a stable placeholder until mounted.
  const isDark = mounted && mode === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <span className="material-symbols-outlined text-[20px]">
        {isDark ? "light_mode" : "dark_mode"}
      </span>
    </button>
  );
}
