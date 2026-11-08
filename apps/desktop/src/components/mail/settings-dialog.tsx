import { CheckIcon, FilterIcon, InfoIcon, KeyboardIcon, SendIcon, UserRoundIcon, MonitorIcon, MoonIcon, PaletteIcon, PlusIcon, SunIcon, UserMinusIcon, UsersIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAccountActions } from "@/hooks/use-account-actions";
import { useAccounts } from "@/hooks/use-mail";
import { ARCHIVE_KEY, isMac, shortcut } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACCENTS, type Density, type ReadingPane, useUi } from "@/store/ui";

import { confirmDialog } from "./dialog-host";
import { AboutSection } from "./about-section";
import { AccountSection } from "./account-section";
import { useAddAccountDialog } from "./add-account-dialog";
import { PersonAvatar } from "./person-avatar";
import { RulesSection } from "./rules-section";
import { SendingSection } from "./sending-section";

export type Section = "account" | "accounts" | "appearance" | "rules" | "sending" | "shortcuts" | "about";

export const useSettings = create<{ open: boolean; section: Section; show: (section?: Section) => void; close: () => void }>()(
  (set) => ({
    open: false,
    section: "accounts",
    show: (section) => set((s) => ({ open: true, section: section ?? s.section })),
    close: () => set({ open: false }),
  }),
);

export const SHORTCUTS: [string, string][] = [
  ["New message", "Ctrl+N"],
  ["Reply", "Ctrl+R"],
  ["Reply all", "Ctrl+Shift+R"],
  ["Forward", "Ctrl+F"],
  ["Send", "Ctrl+Enter"],
  ["Delete", isMac ? "Backspace / Delete" : "Delete"],
  ["Archive", ARCHIVE_KEY],
  ["Mark as read", "Ctrl+Q"],
  ["Mark as unread", "Ctrl+U"],
  ["Flag / unflag", "Insert"],
  ["Search", "Ctrl+E"],
  ["Go to Inbox", "Ctrl+Shift+I"],
  ["Switch account", "Alt+1 … Alt+9"],
  ["Select all", "Ctrl+A"],
  ["Extend selection", "Shift+↑ / Shift+↓"],
  ["Sync", "F9"],
  ["Settings", "Ctrl+,"],
];

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border border-border bg-app/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-[13px] transition-colors",
            value === o.value ? "bg-pane font-semibold shadow-sm" : "text-subtle hover:text-foreground",
          )}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AppearanceSection() {
  const { theme = "system", setTheme } = useTheme();
  const accent = useUi((s) => s.accent);
  const setAccent = useUi((s) => s.setAccent);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const readingPane = useUi((s) => s.readingPane);
  const setReadingPane = useUi((s) => s.setReadingPane);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[16px] font-semibold">Appearance</h3>
        <p className="text-[13px] text-subtle">Changes apply immediately.</p>
      </div>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Mode</h4>
        <Segmented
          value={theme as "light" | "dark" | "system"}
          onChange={setTheme}
          options={[
            { value: "light", label: "Light", icon: SunIcon },
            { value: "dark", label: "Dark", icon: MoonIcon },
            { value: "system", label: "System", icon: MonitorIcon },
          ]}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Color</h4>
        <div role="radiogroup" aria-label="Accent color" className="grid grid-cols-4 gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={accent === a.id}
              onClick={() => setAccent(a.id)}
              className={cn(
                "flex flex-col overflow-hidden rounded-md border text-left transition-shadow",
                accent === a.id ? "border-transparent ring-2 ring-brand" : "border-border hover:border-input",
              )}
            >
              <span className="flex h-9 items-center justify-end px-2" style={{ background: a.swatch }}>
                {accent === a.id && <CheckIcon className="size-4 text-white" strokeWidth={3} />}
              </span>
              <span className="px-2 py-1.5 text-[12px]">{a.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Density</h4>
        <Segmented<Density>
          value={density}
          onChange={setDensity}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Reading pane</h4>
        <Segmented<ReadingPane>
          value={readingPane}
          onChange={setReadingPane}
          options={[
            { value: "right", label: "Right" },
            { value: "bottom", label: "Bottom" },
            { value: "off", label: "Hidden" },
          ]}
        />
      </section>
    </div>
  );
}

export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  const section = useSettings((s) => s.section);
  const setSection = (next: Section) => useSettings.setState({ section: next });
  const onOpenChange = (next: boolean) => useSettings.setState({ open: next });
  const { data: accounts = [] } = useAccounts();
  const { removeAccount, adding } = useAccountActions();

  const nav: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "account", label: "Güneş account", icon: UserRoundIcon },
    { id: "accounts", label: "Mail accounts", icon: UsersIcon },
    { id: "appearance", label: "Appearance", icon: PaletteIcon },
    { id: "rules", label: "Rules", icon: FilterIcon },
    { id: "sending", label: "Sending", icon: SendIcon },
    { id: "shortcuts", label: "Keyboard shortcuts", icon: KeyboardIcon },
    { id: "about", label: "About & updates", icon: InfoIcon },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[560px] max-w-[820px] gap-0 overflow-hidden p-0 sm:max-w-[820px]">
        <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border bg-app/60 p-3">
          <DialogTitle className="px-2 pt-1 pb-3 text-[18px]">Settings</DialogTitle>
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
                section === n.id ? "bg-selected font-semibold" : "hover:bg-hover",
              )}
            >
              <n.icon className={cn("size-4", section === n.id ? "text-brand" : "text-subtle")} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="thin-scroll min-w-0 flex-1 overflow-y-auto p-6">
          {section === "accounts" && (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-[16px] font-semibold">Accounts</h3>
                <p className="text-[13px] text-subtle">Gmail accounts connected to Güneş Mail. Switch between them from the left rail.</p>
              </div>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <PersonAvatar name={a.name} email={a.email} picture={a.picture} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{a.name}</div>
                      <div className="truncate text-[13px] text-subtle">{a.email}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Remove ${a.email}?`,
                          description: "Mail stays in Gmail. This app's access to the account is revoked.",
                          confirmLabel: "Remove",
                          destructive: true,
                        });
                        if (ok) await removeAccount(a);
                      }}
                    >
                      <UserMinusIcon />
                      Remove
                    </Button>
                  </div>
                ))}
                {accounts.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-subtle">No accounts yet.</div>}
              </div>
              <div>
                <Button onClick={() => useAddAccountDialog.getState().setOpen(true)} disabled={adding}>
                  <PlusIcon />
                  Add account
                </Button>
              </div>
            </div>
          )}
          {section === "account" && <AccountSection />}
          {section === "about" && <AboutSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "rules" && <RulesSection />}
          {section === "sending" && <SendingSection onEdit={() => onOpenChange(false)} />}
          {section === "shortcuts" && (
            <div className="flex flex-col gap-4">
              <h3 className="text-[16px] font-semibold">Keyboard shortcuts</h3>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {SHORTCUTS.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2 text-[13px]">
                    <span>{label}</span>
                    <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-sans text-[12px]">{shortcut(keys)}</kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
