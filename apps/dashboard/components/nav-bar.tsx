"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dlq", label: "DLQ" },
  { href: "/demo", label: "Load Test" },
];

export function NavBar() {
  const { theme, setTheme } = useTheme();

  const cycle = () =>
    setTheme(
      theme === "system" ? "light" : theme === "light" ? "dark" : "system",
    );

  return (
    <nav className="flex items-center gap-6 border-b p-4">
      <span className="font-semibold">OmniSync</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-base hover:underline">
          {l.label}
        </Link>
      ))}
      <Button variant="outline" size="sm" className="ml-auto" onClick={cycle}>
        {theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System"}
      </Button>
    </nav>
  );
}
