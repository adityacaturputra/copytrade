import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
