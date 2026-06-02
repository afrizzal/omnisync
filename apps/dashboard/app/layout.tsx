import type { ReactNode } from "react";

export const metadata = {
  title: "OmniSync",
  description: "Distributed Event-Driven Customer Data Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
