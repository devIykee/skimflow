import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import SimulateBanner from "./_components/SimulateBanner";
import KpiBar from "./_components/KpiBar";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/email", label: "Email" },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/wallets", label: "Wallets" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/agents", label: "Agents" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "admin") redirect("/");

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-md md:px-margin-desktop">
      <SimulateBanner />
      <header className="mb-6">
        <h1 className="mb-1 font-display-lg text-display-lg-mobile md:text-display-lg">Platform Admin</h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Signed in as {session.user.email} · operator view
        </p>
      </header>

      <KpiBar />

      <nav className="mb-8 mt-6 flex flex-wrap gap-2 border-b border-outline-variant">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-t-lg px-4 py-2 font-label-lg text-label-lg text-on-surface-variant hover:bg-surface-variant hover:text-on-surface"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
