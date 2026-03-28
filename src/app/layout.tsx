import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AgendaRecap | Jadwal & Rekap Harian",
  description: "Ciptakan dan kelola agenda harian Anda dengan mudah, dan bagikan rekapnya langsung ke WhatsApp.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="dark">
      <body className={`${outfit.className} bg-background text-foreground min-h-screen selection:bg-primary/30`}>
        {children}
      </body>
    </html>
  );
}
