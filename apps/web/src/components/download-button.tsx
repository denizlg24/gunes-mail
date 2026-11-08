"use client";

import { ArrowDownIcon, ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { siApple, siLinux } from "simple-icons";

import { BUILDS, type Detected, detectBuild, type Os, OS_NAMES } from "@/lib/downloads";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

function useDetectedBuild() {
  const [detected, setDetected] = useState<Detected | null>(null);
  useEffect(() => {
    void detectBuild().then(setDetected);
  }, []);
  return detected;
}

function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M2 4.6 10 3.5v7.7H2zm9-1.2L22 2v9.2H11zM2 12.4h8v7.8l-8-1.1zm9 0h11V22l-11-1.5z" />
    </svg>
  );
}

function OsIcon({ os, className }: { os: Os; className?: string }) {
  if (os === "windows") return <WindowsMark className={className} />;
  const icon = os === "mac" ? siApple : siLinux;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d={icon.path} />
    </svg>
  );
}

const ORDER: Os[] = ["mac", "windows", "linux"];

type Side = "top" | "bottom";

function AllBuildsMenu({ current, align, side }: { current: Detected | null; align: "center" | "end"; side: Side }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] text-white/70 ring-1 ring-white/12 transition hover:bg-white/[0.05] hover:text-white"
      >
        {current ? "Other platforms" : "All downloads"}
        <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className={cn(
          "absolute z-20 w-[300px] rounded-2xl bg-[#11151f] p-1.5 text-left shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10",
          align === "center" ? "left-1/2 -translate-x-1/2" : "right-0",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
        )}
      >
        {ORDER.map((os) => (
          <div key={os} className="py-1">
            <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 text-[12px] text-white/40">
              <OsIcon os={os} className="size-3.5" />
              {OS_NAMES[os]}
            </div>
            {BUILDS.filter((b) => b.os === os).map((b) => (
              <a
                key={b.href}
                href={b.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "group flex items-center justify-between rounded-lg px-3 py-2 text-[14px] text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white",
                  current?.build.href === b.href && "text-white",
                )}
              >
                <span>
                  {b.label}
                  {current?.build.href === b.href && <span className="ml-2 text-[12px] text-[#6f95ff]">Recommended</span>}
                </span>
                <span className="flex items-center gap-2 text-[12px] text-white/35">
                  {b.format}
                  <ArrowDownIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </a>
            ))}
          </div>
        ))}
        <a
          href={site.releases}
          className="mt-1 block border-t border-white/[0.07] px-3 pt-2.5 pb-1.5 text-[12px] text-white/40 hover:text-white/70"
        >
          Release notes and checksums
        </a>
      </div>
    </div>
  );
}

export function DownloadButtons({ align = "center", side = "bottom" }: { align?: "center" | "end"; side?: Side }) {
  const detected = useDetectedBuild();
  return (
    <div className={cn("flex flex-wrap items-center gap-3", align === "center" ? "justify-center" : "justify-end")}>
      <a
        href={detected?.build.href ?? site.releases}
        className="group inline-flex items-center gap-3 rounded-full bg-white py-1.5 pr-1.5 pl-6 text-[15px] font-medium text-[#080b12] transition hover:bg-white/90"
      >
        {detected && <OsIcon os={detected.os} className="-ml-1 size-4" />}
        {detected ? `Download for ${OS_NAMES[detected.os]}` : "Download for free"}
        <span className="flex size-9 items-center justify-center rounded-full bg-[#2f6bff] text-white">
          <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </a>
      <AllBuildsMenu current={detected} align={align} side={side} />
    </div>
  );
}

export function DownloadLink({ className, children }: { className?: string; children: React.ReactNode }) {
  const detected = useDetectedBuild();
  return (
    <a href={detected?.build.href ?? site.releases} className={className}>
      {children}
    </a>
  );
}

export function DownloadCaption() {
  const detected = useDetectedBuild();
  return (
    <p className={cn("mt-4 text-[12px] text-white/35 transition-opacity", detected ? "opacity-100" : "opacity-0")}>
      Version {process.env.NEXT_PUBLIC_APP_VERSION}
      {detected && ` · ${detected.build.label} ${detected.build.format}`}
    </p>
  );
}
