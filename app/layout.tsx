import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next"
import "./globals.css";

export const metadata: Metadata = {
  title: "EliseAI Lead Enrichment",
  description:
    "Enrich, score, and draft outreach for inbound EliseAI multifamily leads.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
      <Analytics/>
    </html>
  );
}
