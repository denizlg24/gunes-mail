"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const FEATURES = [
  {
    title: "Right-click anything",
    body: "Context menus, drag to folders, Shift and Ctrl to select. It behaves like the desktop mail you grew up with.",
    image: "/shots/feature-menu.jpg",
    alt: "A message's right-click menu with Reply, Archive, Move and Categorize options",
  },
  {
    title: "Send it later",
    body: "Schedule for Monday morning or take a message back within seconds. It still goes out with your laptop closed.",
    image: "/shots/feature-schedule.jpg",
    alt: "The compose window with the schedule send menu open",
  },
  {
    title: "Rules that file mail for you",
    body: "Move receipts, flag your manager, quiet newsletters. Rules run on the server the moment mail arrives.",
    image: "/shots/feature-rules.jpg",
    alt: "The rule editor with a condition and a move-to-folder action",
  },
  {
    title: "Pick up on any computer",
    body: "Sign in elsewhere and your inboxes, rules, signature and theme are already waiting.",
    image: "/shots/feature-devices.jpg",
    alt: "Account settings listing signed-in devices",
  },
];

const CYCLE_MS = 6000;

export function FeatureShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => setActive((i) => (i + 1) % FEATURES.length), CYCLE_MS);
    return () => clearTimeout(timer);
  }, [active, paused]);

  return (
    <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
      <ul className="flex flex-col" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        {FEATURES.map((f, i) => (
          <li key={f.title}>
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={active === i}
              className="relative block w-full py-5 pl-7 text-left"
            >
              <span className="absolute top-0 bottom-0 left-0 w-px bg-ink/10" />
              <span
                className={cn(
                  "absolute top-0 left-0 w-px origin-top bg-[#2f6bff] transition-[height] ease-linear",
                  active === i ? "h-full" : "h-0",
                )}
                style={{ transitionDuration: active === i && !paused ? `${CYCLE_MS}ms` : "300ms" }}
              />
              <span className={cn("block text-[19px] tracking-tight transition-colors", active === i ? "text-ink" : "text-ink/40")}>
                {f.title}
              </span>
              <span
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-500",
                  active === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <span className="overflow-hidden">
                  <span className="block pt-2 text-[15px] leading-relaxed text-ink/55">{f.body}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] bg-[radial-gradient(120%_90%_at_70%_10%,#e7efff_0%,#f4f1ea_55%,#f7f6f2_100%)] ring-1 ring-ink/5">
        {FEATURES.map((f, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={f.image}
            src={f.image}
            alt={f.alt}
            loading={i === 0 ? "eager" : "lazy"}
            className={cn(
              "absolute inset-0 m-auto max-h-[90%] max-w-[94%] rounded-xl object-contain shadow-[0_24px_60px_-20px_rgba(20,30,60,0.35),0_0_0_1px_rgba(20,30,60,0.06)] transition-all duration-700",
              active === i ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
            )}
          />
        ))}
      </div>
    </div>
  );
}
