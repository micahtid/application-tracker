import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

// Self hosted at build time, so a privacy first app fetches nothing from Google
// while you are reading your board.
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Internship Applications Tracker",
  description: "Your applications, read out of your own inbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className={figtree.className}>{children}</body>
    </html>
  );
}
