import { ServerIcon } from "lucide-react";
import { siGmail, siIcloud } from "simple-icons";

function SimpleIcon({ icon }: { icon: { path: string; hex: string; title: string } }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-label={icon.title} role="img">
      <path d={icon.path} fill={`#${icon.hex}`} />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" aria-label="Microsoft 365" role="img">
      <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
      <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
      <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
    </svg>
  );
}

function OutlookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-label="Outlook.com" role="img">
      <rect x="8" y="4" width="15" height="16" rx="2" fill="#28A8EA" />
      <path d="M8 9h15v9a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2Z" fill="#0078D4" />
      <path d="M8 9l7.5 5L23 9" fill="none" stroke="#50D9FF" strokeWidth="1.2" />
      <rect x="1" y="6" width="12" height="12" rx="2" fill="#0F6CBD" />
      <ellipse cx="7" cy="12" rx="3" ry="3.4" fill="none" stroke="#fff" strokeWidth="1.8" />
    </svg>
  );
}

function YahooMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-label="Yahoo Mail" role="img">
      <path d="M2 6h4.4l2.6 6.4L11.6 6H16l-5.2 11.3V22H7.2v-4.7Z" fill="#6001D2" />
      <path d="M18.6 3h4.4l-3.6 10.5h-3Z" fill="#6001D2" />
      <circle cx="17.6" cy="16.8" r="2.1" fill="#6001D2" />
    </svg>
  );
}

function FastmailMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-label="Fastmail" role="img">
      <rect x="1.5" y="4" width="21" height="16" rx="3" fill="#0067B9" />
      <path d="M4.5 8 12 13l7.5-5" fill="none" stroke="#FFC107" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZohoMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-label="Zoho Mail" role="img">
      <rect x="1" y="7" width="5" height="10" rx="1" fill="#E42527" transform="rotate(-8 3.5 12)" />
      <rect x="6.6" y="7" width="5" height="10" rx="1" fill="#089949" transform="rotate(6 9.1 12)" />
      <rect x="12.4" y="7" width="5" height="10" rx="1" fill="#226DB4" transform="rotate(-6 14.9 12)" />
      <rect x="18" y="7" width="5" height="10" rx="1" fill="#F9B21D" transform="rotate(8 20.5 12)" />
    </svg>
  );
}

export const PROVIDER_ICONS: Record<string, () => React.ReactNode> = {
  Gmail: () => <SimpleIcon icon={siGmail} />,
  "Microsoft 365": MicrosoftMark,
  "Outlook.com": OutlookMark,
  "iCloud Mail": () => <SimpleIcon icon={siIcloud} />,
  "Yahoo Mail": YahooMark,
  Fastmail: FastmailMark,
  "Zoho Mail": ZohoMark,
  "Any IMAP": () => <ServerIcon className="size-5 text-white/70" strokeWidth={1.6} />,
};
