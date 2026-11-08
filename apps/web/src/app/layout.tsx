import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { site } from "@/lib/site";

import "./globals.css";

const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: "Güneş Mail — every inbox, one quiet place", template: "%s · Güneş Mail" },
  description:
    "A fast desktop mail client for Gmail, Outlook and any IMAP account, with rules, scheduled send and sync across your devices.",
  openGraph: { siteName: "Güneş Mail", type: "website", images: ["/shots/app-dark.jpg"] },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
