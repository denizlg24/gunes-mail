import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

import { DownloadLink } from "./download-button";
import { Logo } from "./logo";

type Tone = "dark" | "light";

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/privacy/", label: "Privacy" },
  { href: site.repo, label: "Source" },
];

export function SiteNav({ tone }: { tone: Tone }) {
  const dark = tone === "dark";
  return (
    <header className="flex h-14 items-center justify-between">
      <Link href="/" aria-label="Güneş Mail home" className={dark ? "text-white" : "text-ink"}>
        <Logo />
      </Link>
      <nav
        className={cn(
          "hidden items-center gap-1 rounded-full p-1 text-[13px] md:flex",
          dark ? "bg-white/[0.04] ring-1 ring-white/10" : "bg-ink/[0.03] ring-1 ring-ink/10",
        )}
      >
        {NAV.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "rounded-full px-4 py-1.5 transition-colors",
              dark ? "text-white/60 hover:bg-white/[0.06] hover:text-white" : "text-ink/60 hover:bg-ink/[0.05] hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <DownloadLink
        className={cn(
          "group inline-flex items-center gap-2 rounded-full py-1 pr-1 pl-4 text-[13px] font-medium transition-colors",
          dark ? "bg-white/[0.06] text-white ring-1 ring-white/12 hover:bg-white/[0.1]" : "bg-ink text-paper hover:bg-ink/90",
        )}
      >
        Download
        <span className="flex size-7 items-center justify-center rounded-full bg-[#2f6bff] text-white">
          <ArrowUpRightIcon className="size-3.5 transition-transform group-hover:translate-x-px group-hover:-translate-y-px" />
        </span>
      </DownloadLink>
    </header>
  );
}

export function SiteFooter({ tone }: { tone: Tone }) {
  const dark = tone === "dark";
  const link = dark ? "text-white/45 hover:text-white" : "text-ink/50 hover:text-ink";
  return (
    <footer className={cn("mx-auto w-full max-w-6xl px-6 py-10 text-[13px]", dark ? "text-white/45" : "text-ink/50")}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Güneş Mail · MIT licensed</span>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/privacy/" className={link}>
            Privacy
          </Link>
          <Link href="/terms/" className={link}>
            Terms
          </Link>
          <Link href="/account/" className={link}>
            Account
          </Link>
          <a href={site.repo} className={link}>
            GitHub
          </a>
          <a href={site.contactEmail ? `mailto:${site.contactEmail}` : site.issues} className={link}>
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
