import { ArrowDownIcon, ArrowRightIcon, ClockIcon, FilterIcon, InboxIcon, KeyboardIcon, SendIcon, SparklesIcon } from "lucide-react";

import { FeatureShowcase } from "@/components/feature-showcase";
import { ProviderGraph } from "@/components/provider-graph";
import { SiteFooter, SiteNav } from "@/components/site-chrome";
import { site } from "@/lib/site";

const TILES = [
  { Icon: InboxIcon, left: "9%", top: "34%", tilt: "-8deg", delay: "0s" },
  { Icon: FilterIcon, left: "22%", top: "18%", tilt: "10deg", delay: "1.2s" },
  { Icon: ClockIcon, left: "50%", top: "9%", tilt: "-4deg", delay: "2.4s" },
  { Icon: SendIcon, left: "78%", top: "18%", tilt: "8deg", delay: "0.6s" },
  { Icon: KeyboardIcon, left: "91%", top: "34%", tilt: "-10deg", delay: "1.8s" },
];

function Grid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_40%,black_20%,transparent_75%)]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
        backgroundSize: "72px 72px",
      }}
    />
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[#080b12] ring-1 ring-white/[0.07]">
      <Grid />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[18%] left-1/2 aspect-square w-[150%] -translate-x-1/2 rounded-full ring-1 ring-white/[0.06] sm:w-[115%]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-30%] left-1/2 h-[70%] w-[90%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(47,107,255,0.45),transparent)] blur-2xl"
      />
      {TILES.map(({ Icon, left, top, tilt, delay }) => (
        <span
          key={left}
          aria-hidden
          className="animate-drift absolute hidden size-11 -translate-x-1/2 items-center justify-center rounded-xl bg-white/[0.04] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/10 backdrop-blur md:flex"
          style={{ left, top, ["--tilt" as string]: tilt, animationDelay: delay }}
        >
          <Icon className="size-[18px]" strokeWidth={1.6} />
        </span>
      ))}

      <div className="relative px-5 pt-4 sm:px-8">
        <SiteNav tone="dark" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 pt-24 text-center sm:pt-32">
        <h1 className="text-[44px] leading-[1.02] font-medium tracking-[-0.035em] text-white sm:text-[76px]">
          Every inbox.
          <br />
          <span className="bg-gradient-to-r from-white via-[#c9d8ff] to-[#6f95ff] bg-clip-text text-transparent">
            One quiet place.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/55">
          A fast desktop mail client for Gmail, Outlook and everything else, that keeps working while your laptop sleeps.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href={site.releases}
            className="group inline-flex items-center gap-3 rounded-full bg-white py-1.5 pr-1.5 pl-6 text-[15px] font-medium text-[#080b12] transition hover:bg-white/90"
          >
            Download for free
            <span className="flex size-9 items-center justify-center rounded-full bg-[#2f6bff] text-white">
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
          <a
            href={site.repo}
            className="rounded-full px-6 py-3 text-[15px] text-white/70 ring-1 ring-white/12 transition hover:bg-white/[0.05] hover:text-white"
          >
            Read the source
          </a>
        </div>
      </div>

      <div className="relative mx-auto mt-20 max-w-[1120px] px-4 sm:mt-24 sm:px-10">
        <div className="rounded-t-[18px] bg-white/[0.04] p-2 pb-0 ring-1 ring-white/10 backdrop-blur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/shots/app-dark.jpg"
            alt="Güneş Mail showing two Gmail accounts, a focused inbox and an open conversation"
            width={2880}
            height={1760}
            className="block w-full rounded-t-[12px]"
          />
        </div>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#080b12] to-transparent" />
      </div>
      <a
        href="#product"
        className="absolute right-8 bottom-6 hidden items-center gap-1.5 text-[12px] text-white/40 hover:text-white/70 lg:flex"
      >
        Scroll to explore <ArrowDownIcon className="size-3" />
      </a>
    </section>
  );
}

function Statement() {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[#080b12] px-6 py-28 ring-1 ring-white/[0.07] sm:px-16">
      <Grid />
      <div className="relative mx-auto max-w-4xl">
        <p className="text-center text-[26px] leading-[1.35] font-medium tracking-[-0.02em] text-white sm:text-[34px]">
          Your mail syncs on our server, not your battery. Rules run the moment mail lands, scheduled messages leave on
          time, <span className="text-white/35">and every computer you sign in to opens exactly where you left off.</span>
        </p>
        <dl className="mt-20 grid grid-cols-2 gap-x-8 gap-y-12 lg:grid-cols-4">
          {[
            ["0", "ads, trackers or data sales"],
            ["AES-256", "encryption for every stored credential"],
            ["1 click", "deletes your account and all synced mail"],
            ["MIT", "licensed, with every line on GitHub"],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="border-b border-white/10 pb-4 text-[34px] font-medium tracking-[-0.03em] text-white">{value}</dt>
              <dd className="pt-3 text-[13px] text-white/45">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#05070b] p-2 sm:p-3">
      <Hero />

      <section id="product" className="mx-auto max-w-6xl scroll-mt-6 px-6 py-28 sm:py-36">
        <h2 className="max-w-2xl text-[36px] leading-[1.08] font-medium tracking-[-0.03em] text-white sm:text-[48px]">
          Feels like the mail app you already know.{" "}
          <span className="text-white/35">Only faster.</span>
        </h2>
        <div className="mt-16 rounded-[28px] bg-[#f7f6f2] p-6 sm:p-12">
          <FeatureShowcase />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-28 sm:pb-36">
        <div className="grid items-end gap-10 lg:grid-cols-2">
          <h2 className="text-[36px] leading-[1.08] font-medium tracking-[-0.03em] text-white sm:text-[48px]">
            Gmail, Outlook and the rest. <span className="text-white/35">Side by side.</span>
          </h2>
          <p className="max-w-md text-[16px] leading-relaxed text-white/50 lg:justify-self-end">
            Add as many accounts as you like and switch with a click or Alt+1, Alt+2. Each keeps its own folders, counts and
            rules.
          </p>
        </div>
        <div className="mt-16">
          <ProviderGraph />
        </div>
      </section>

      <Statement />

      <section className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <h2 className="text-[36px] leading-[1.08] font-medium tracking-[-0.03em] text-white sm:text-[48px]">
            AI that works for you, <span className="text-white/35">not on you.</span>
          </h2>
          <div className="space-y-6 text-[16px] leading-relaxed text-white/55">
            <p>
              Next up: summaries of long threads, replies drafted in your own voice, and rules you can describe in a
              sentence.
            </p>
            <p>
              Every AI feature will be opt-in, show you exactly what it reads, and never use your mail to train a model.
              That promise is already in our{" "}
              <a href="/privacy/" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                privacy policy
              </a>
              .
            </p>
            <p className="flex items-center gap-2 text-white/40">
              <SparklesIcon className="size-4 text-[#6f95ff]" strokeWidth={1.6} />
              Arriving in a future update, free for everyone.
            </p>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-[28px] bg-[#080b12] px-6 py-28 text-center ring-1 ring-white/[0.07]">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-1/2 left-1/2 h-full w-[80%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(47,107,255,0.35),transparent)] blur-2xl"
        />
        <h2 className="relative text-[40px] leading-[1.05] font-medium tracking-[-0.035em] text-white sm:text-[60px]">
          Bring every inbox home.
        </h2>
        <p className="relative mt-5 text-white/50">macOS, Windows and Linux. Free, open source, yours to delete anytime.</p>
        <a
          href={site.releases}
          className="group relative mt-10 inline-flex items-center gap-3 rounded-full bg-white py-1.5 pr-1.5 pl-6 text-[15px] font-medium text-[#080b12] transition hover:bg-white/90"
        >
          Download Güneş Mail
          <span className="flex size-9 items-center justify-center rounded-full bg-[#2f6bff] text-white">
            <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </a>
      </section>

      <SiteFooter tone="dark" />
    </div>
  );
}
