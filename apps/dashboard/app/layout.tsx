import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { NavBar } from "@/components/nav-bar";

export const metadata = {
  title: "OmniSync",
  description: "Distributed Event-Driven Customer Data Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <NavBar />
          <main className="container mx-auto p-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
