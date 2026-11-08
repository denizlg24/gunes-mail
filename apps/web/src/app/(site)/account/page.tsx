import type { Metadata } from "next";

import { AccountPanel } from "./account-panel";

export const metadata: Metadata = {
  title: "Your account",
  description: "Sign in to manage your Güneş Mail devices or delete your account and data.",
};

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <AccountPanel />
    </div>
  );
}
