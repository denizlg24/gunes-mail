"use client";

import dynamic from "next/dynamic";

const MailApp = dynamic(() => import("@/components/mail/mail-app").then((m) => m.MailApp), {
  ssr: false,
});

export default function Home() {
  return <MailApp />;
}
