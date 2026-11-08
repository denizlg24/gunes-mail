import type { Metadata } from "next";
import Link from "next/link";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Güneş Mail collects, uses, stores and deletes your data, including data from Google APIs.",
};

function Contact() {
  return site.contactEmail ? (
    <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
  ) : (
    <a href={site.issues}>our GitHub issue tracker</a>
  );
}

export default function PrivacyPage() {
  return (
    <article className="prose-legal mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-3 text-sm text-muted">Last updated {site.legalUpdated}</p>

      <p className="mt-8">
        Güneş Mail (&quot;Güneş Mail&quot;, &quot;we&quot;, &quot;us&quot;) is a desktop email client operated by {site.operator}.
        This policy explains what information the Güneş Mail desktop app, the sync service at{" "}
        <code>{new URL(site.apiUrl).host}</code> and this website handle, why, and the choices you have. The short version: we
        process your mail only to show it to you and to perform the actions you ask for. We do not sell it, use it for
        advertising, or use it to train AI models.
      </p>

      <h2>Information we process</h2>
      <h3>Your Güneş account</h3>
      <ul>
        <li>Your name and, if you choose to set them, a sign-in email address and password. Passwords are stored only as a salted Argon2 hash.</li>
        <li>Your preferences (theme, layout, signature, undo-send window) so they follow you to other devices.</li>
        <li>A list of your signed-in devices: a device name, browser or app user agent, and when each was last active.</li>
      </ul>
      <h3>Connected mailboxes</h3>
      <p>When you connect a mailbox, Güneş Mail accesses it on your behalf:</p>
      <ul>
        <li>
          <strong>Google (Gmail)</strong>: with your permission we access your Gmail messages, labels, drafts and settings
          (scope <code>https://mail.google.com/</code>), your basic profile (name, email address, profile photo), and your Google
          contacts and &quot;other contacts&quot; (scopes <code>contacts.readonly</code> and <code>contacts.other.readonly</code>).
        </li>
        <li>
          <strong>Microsoft (Outlook.com, Microsoft 365)</strong>: your mail, mail folders, contacts and people suggestions,
          and basic profile, through Microsoft Graph.
        </li>
        <li>
          <strong>Other providers (IMAP/SMTP)</strong>: your mailbox contents and the app password you provide.
        </li>
      </ul>
      <p>
        For each mailbox we store an OAuth refresh token or app password, encrypted with AES-256-GCM. To keep your mail fast
        and available on all your devices, we also keep a copy of message metadata (sender, recipients, subject, date,
        labels, a short preview), message bodies and attachment details for messages you open, and the contacts used to
        suggest recipients. Attachments themselves are fetched from your provider when you open them and are not stored by
        us.
      </p>
      <h3>Website</h3>
      <p>
        This website does not use cookies, analytics or tracking pixels. The account page stores your session token in your
        browser&apos;s local storage only while you are signed in.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To show your mail, contacts and folders in the app, and keep them in sync across your devices.</li>
        <li>To perform the actions you request: sending, scheduling, replying, moving, labeling, deleting and archiving messages, and saving drafts.</li>
        <li>To run the rules you create (for example, moving messages from a sender into a folder) when new mail arrives.</li>
        <li>To suggest recipients and show contact photos while you write.</li>
        <li>To keep the service secure and working, for example by rate-limiting sign-in attempts and diagnosing errors.</li>
      </ul>
      <p>We do not use your data for advertising, we do not sell it, and we do not build profiles of you for any other purpose.</p>

      <h2>Google user data</h2>
      <p>
        <strong>
          Güneş Mail&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
          including the Limited Use requirements.
        </strong>
      </p>
      <p>Specifically:</p>
      <ul>
        <li>We use Google user data only to provide and improve the user-facing email features of Güneş Mail described above.</li>
        <li>We do not transfer Google user data to others except as necessary to provide those features, to comply with applicable law, or as part of a merger or acquisition with your notice.</li>
        <li>We do not use Google user data for serving advertisements, including retargeting, personalized or interest-based advertising.</li>
        <li>
          No person reads your Google user data unless you give us explicit permission for specific messages (for example
          when you ask for support), it is necessary for security purposes such as investigating abuse, it is required to
          comply with law, or the data has been aggregated and anonymized for internal operations.
        </li>
        <li>We do not use Google user data to develop, improve or train generalized or non-personalized AI or machine-learning models.</li>
      </ul>

      <h2>AI features</h2>
      <p>
        Güneş Mail does not currently include AI features. When we add features such as thread summaries or suggested
        replies, they will be off until you turn them on, we will explain exactly which content is processed and by which
        provider before you do, and your content will never be used to train AI models, ours or anyone else&apos;s. We will
        update this policy before any such feature is released.
      </p>

      <h2>Sharing and service providers</h2>
      <p>We share data only with the services needed to run Güneş Mail:</p>
      <ul>
        <li>Your mail providers (Google, Microsoft, or your IMAP/SMTP host), to read and send mail on your behalf.</li>
        <li>Cloudflare, which carries encrypted traffic between the app and our servers.</li>
        <li>The infrastructure that hosts our servers and database, operated by {site.operator}.</li>
      </ul>
      <p>We may disclose information if required by law, and will notify you where we are allowed to.</p>

      <h2>Security</h2>
      <ul>
        <li>All traffic between the app, this website and our servers uses TLS.</li>
        <li>Mailbox credentials are encrypted at rest with AES-256-GCM; passwords are hashed with Argon2.</li>
        <li>Sign-ins on the desktop use OAuth with PKCE in your own browser; we never see your Google or Microsoft password.</li>
        <li>Access to production systems is limited to the operator.</li>
      </ul>

      <h2>Retention and deletion</h2>
      <ul>
        <li>We keep your data for as long as your Güneş account exists.</li>
        <li>Removing a mailbox in the app deletes its credentials and every message, label and contact synced from it.</li>
        <li>
          Deleting your account (in the app under Settings → Güneş account, or on the{" "}
          <Link href="/account/">account page</Link>) immediately deletes your account, devices, mailboxes, synced mail,
          rules, scheduled messages and settings, and revokes Güneş Mail&apos;s access to your Google account. Backups that
          may contain your data are overwritten within 30 days.
        </li>
        <li>
          You can also revoke access at any time from your{" "}
          <a href="https://myaccount.google.com/permissions">Google Account permissions</a> or Microsoft account settings.
        </li>
        <li>Mail stored at your provider is never deleted by these actions.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR), you can ask to access, correct, export or delete your
        data, or object to its processing. Most of this you can do directly in the app; for anything else, contact us at{" "}
        <Contact />. You may also lodge a complaint with your local data protection authority.
      </p>

      <h2>Children</h2>
      <p>Güneş Mail is not directed to children under 16 and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        We will post any changes on this page and update the date above. For material changes, we will notify you in the app
        before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about privacy: <Contact />.
      </p>
    </article>
  );
}
