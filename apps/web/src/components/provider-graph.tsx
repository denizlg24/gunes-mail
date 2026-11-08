import { LogoMark } from "./logo";
import { PROVIDER_ICONS } from "./provider-icons";

const PROVIDERS = [
  { name: "Gmail", x: 8, y: 22 },
  { name: "Microsoft 365", x: 22, y: 8 },
  { name: "Outlook.com", x: 26, y: 70 },
  { name: "Zoho Mail", x: 40, y: 92 },
  { name: "Any IMAP", x: 60, y: 92 },
  { name: "iCloud Mail", x: 74, y: 70 },
  { name: "Fastmail", x: 78, y: 8 },
  { name: "Yahoo Mail", x: 92, y: 22 },
];

const HUB = { x: 50, y: 42 };

function path(p: { x: number; y: number }) {
  const midY = (p.y + HUB.y) / 2;
  return `M ${p.x * 10} ${p.y * 4.2} C ${p.x * 10} ${midY * 4.2}, ${HUB.x * 10} ${midY * 4.2}, ${HUB.x * 10} ${HUB.y * 4.2}`;
}

export function ProviderGraph() {
  return (
    <div className="relative mx-auto aspect-[1000/420] w-full max-w-4xl">
      <svg viewBox="0 0 1000 420" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id="wire" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b8cff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#8fb0ff" stopOpacity="1" />
          </linearGradient>
        </defs>
        {PROVIDERS.map((p) => (
          <g key={p.name}>
            <path d={path(p)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <path
              d={path(p)}
              fill="none"
              stroke="url(#wire)"
              strokeWidth="2"
              strokeDasharray="14 50"
              className="animate-flow"
              style={{ animationDelay: `${(p.x * 37) % 3000}ms` }}
            />
          </g>
        ))}
      </svg>
      <div
        className="absolute flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-[#0d1220] shadow-[0_0_60px_-6px_rgba(47,107,255,0.65)] ring-1 ring-[#5b8cff]/50"
        style={{ left: `${HUB.x}%`, top: `${HUB.y}%` }}
      >
        <LogoMark className="size-9" />
      </div>
      {PROVIDERS.map((p) => (
        <div
          key={p.name}
          className={`absolute flex -translate-x-1/2 items-center gap-2 ${p.y < HUB.y ? "-translate-y-[calc(100%-24px)] flex-col-reverse" : "-translate-y-6 flex-col"}`}
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        >
          <span className="flex size-12 items-center justify-center rounded-xl bg-[#121722] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/12">
            {PROVIDER_ICONS[p.name]()}
          </span>
          <span className="text-[11px] whitespace-nowrap text-white/45">{p.name}</span>
        </div>
      ))}
    </div>
  );
}
