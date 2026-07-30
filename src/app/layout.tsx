import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, Source_Serif_4 } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/auth";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600", "700"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "600", "700"],
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Read — Books in your browser",
  description:
    "Publish PDF and DOCX books, auto-split chapters, and read free or paid titles in a mobile-friendly in-app reader.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#d5e2dd",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();

  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${fraunces.variable} ${sourceSerif.variable} antialiased`}
        style={
          {
            "--font-ui": "var(--font-dm-sans), system-ui, sans-serif",
            "--font-display": "var(--font-fraunces), Georgia, serif",
            "--font-reader": "var(--font-source-serif), Georgia, serif",
          } as React.CSSProperties
        }
      >
        <AppShell user={session.user ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
