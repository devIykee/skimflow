"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile bottom navigation ("sandwich bar"). Mirrors the desktop header nav
 * (For You / Docs) plus Dashboard (which on desktop lives in the footer +
 * UserMenu). Home is reachable via the LinePay logo, so it's omitted here.
 * Hidden at md+ where the top nav takes over.
 */
const ITEMS: { href: string; label: string; icon: string }[] = [
  { href: "/for-you", label: "For You", icon: "auto_awesome" },
  { href: "/docs", label: "Docs", icon: "menu_book" },
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-outline-variant bg-surface md:hidden"
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-max-width items-stretch justify-around">
        {ITEMS.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors ${
                  active ? "text-primary" : "text-on-surface-variant hover:text-on-surface"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className={`material-symbols-outlined text-[22px] ${active ? "[font-variation-settings:'FILL'_1]" : ""}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
