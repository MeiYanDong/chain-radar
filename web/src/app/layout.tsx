import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chain Radar — FAT Token Holder Analysis",
  description: "Analyze FAT token holders, cost basis, and trading activity on Base chain",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased dark"
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Chain Radar
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-100 transition-colors">Holders</Link>
            <Link href="/positions" className="hover:text-zinc-100 transition-colors">AI Pot Positions</Link>
          </nav>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
