export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2886de" />
          <stop offset="1" stopColor="#0f548c" />
        </linearGradient>
        <linearGradient id="logo-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd24d" />
          <stop offset="1" stopColor="#ff8c1a" />
        </linearGradient>
        <clipPath id="logo-clip">
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <g clipPath="url(#logo-clip)">
        <rect width="64" height="64" fill="url(#logo-bg)" />
        <circle cx="32" cy="30" r="13" fill="url(#logo-sun)" />
      </g>
      <rect x="14" y="29" width="36" height="24" rx="4" fill="#fff" />
      <path d="M16 31.5 32 42.5 48 31.5" fill="none" stroke="#0f6cbd" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
      <LogoMark />
      Güneş Mail
    </span>
  );
}
