import type { Metadata, Viewport } from "next";
import { ClientProviders } from "@/lib/components/ClientProviders";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "CopyTrade - AI Trading Signal Copier",
  description:
    "Automated trading bot that copies Discord signals to MEXC exchange with AI-powered position management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-dark-200 text-slate-100">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
