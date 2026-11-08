import { SiteFooter, SiteNav } from "@/components/site-chrome";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <div className="mx-auto w-full max-w-6xl px-6 pt-5">
        <SiteNav tone="light" />
      </div>
      <main className="flex-1">{children}</main>
      <SiteFooter tone="light" />
    </div>
  );
}
