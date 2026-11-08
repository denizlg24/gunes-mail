export const site = {
  name: "Güneş Mail",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://gunes-mail.denizlg24.com",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "https://gunes-mail-api.denizlg24.com",
  repo: "https://github.com/denizlg24/gunes-mail",
  releases: "https://github.com/denizlg24/gunes-mail/releases/latest",
  issues: "https://github.com/denizlg24/gunes-mail/issues",
  /** The person or company operating the service, as shown on the Google consent screen. */
  operator: process.env.NEXT_PUBLIC_OPERATOR_NAME ?? "the Güneş Mail developer",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "geral@oceaninformatix.com",
  legalUpdated: "8 November 2026",
};
