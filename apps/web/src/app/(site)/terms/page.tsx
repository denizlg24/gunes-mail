import type { Metadata } from "next";
import Link from "next/link";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply when you use Güneş Mail.",
};

export default function TermsPage() {
  return (
    <article className="prose-legal mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-3 text-sm text-muted">Last updated {site.legalUpdated}</p>

      <p className="mt-8">
        These terms apply to the Güneş Mail desktop app, the Güneş Mail sync service and this website (together, &quot;the
        Service&quot;), operated by {site.operator}. By using the Service you agree to them. If you don&apos;t agree, please
        don&apos;t use the Service.
      </p>

      <h2>The Service</h2>
      <p>
        Güneş Mail is an email client. It connects to mail accounts you own or are authorized to use, syncs their contents
        so you can read and manage them across your devices, and performs actions you request, such as sending, scheduling
        and filing messages. The app&apos;s source code is published under its open-source license at{" "}
        <a href={site.repo}>{site.repo.replace("https://", "")}</a>; that license governs your use of the code. These terms
        govern your use of the hosted sync service.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 16 years old, or the age of digital consent where you live.</li>
        <li>You are responsible for keeping your devices, password and connected mail accounts secure, and for activity under your account.</li>
        <li>You may only connect mailboxes you own or are authorized to access.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        Your mail remains yours. You give us only the permission needed to store, process and transmit it to operate the
        Service for you, as described in our <Link href="/privacy/">Privacy Policy</Link>. This permission ends when you
        delete the content or your account.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>send spam, phishing or other unsolicited bulk messages, or mail that violates your provider&apos;s terms;</li>
        <li>break the law, infringe others&apos; rights, or distribute malware;</li>
        <li>access accounts or data you are not authorized to access;</li>
        <li>overload, probe or interfere with the Service or circumvent its security or rate limits.</li>
      </ul>
      <p>We may suspend accounts that put the Service or other people at risk.</p>

      <h2>Third-party services</h2>
      <p>
        The Service works with Google, Microsoft and other mail providers. Your use of those accounts remains subject to
        their own terms, and they may change or limit access at any time, which may affect the Service.
      </p>

      <h2>Availability and changes</h2>
      <p>
        The Service is provided free of charge. We work to keep it reliable, but it is offered &quot;as is&quot; and
        &quot;as available&quot;, without warranties of any kind, to the fullest extent permitted by law. We may change,
        suspend or discontinue features, and will give reasonable notice before discontinuing the sync service so you can
        remove your data.
      </p>

      <h2>Liability</h2>
      <p>
        To the fullest extent permitted by law, the operator is not liable for any indirect, incidental or consequential
        damages, or for loss of data, arising from your use of the Service. Nothing in these terms limits liability that
        cannot be limited by law.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using the Service and delete your account at any time from the app or the{" "}
        <Link href="/account/">account page</Link>. Deleting your account removes your data from our servers as described in
        the Privacy Policy.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. We will post changes here and update the date above; material changes will be announced
        in the app before they take effect. Continuing to use the Service after that means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        {site.contactEmail ? (
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        ) : (
          <a href={site.issues}>Open an issue on GitHub</a>
        )}
      </p>
    </article>
  );
}
