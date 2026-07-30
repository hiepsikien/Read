export const CURRENT_LEGAL_VERSION = "2026-07-30";

export const LEGAL_DOCUMENTS = {
  terms: {
    title: "Terms of Use",
    paragraphs: [
      "Use Read lawfully and respect the rights of readers, authors, and publishers. Accounts are personal; do not abuse access controls, automate harmful traffic, or impersonate another person.",
      "You must be old enough to form a binding agreement under applicable law and the rules of the app store through which you access Read.",
      "Read may restrict content or accounts that violate these terms, the Community Guidelines, or applicable law.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    paragraphs: [
      "Read stores account identity, roles, manuscripts, purchases, moderation decisions, reports, and policy acceptance records needed to operate the service.",
      "Unpublished books are restricted to their publisher and administrators. Published books and covers are public inside Read.",
      "Operational providers may process data for hosting, authentication, text-to-speech, and product features. Read does not sell personal information.",
    ],
  },
  publisher: {
    title: "Publisher Agreement",
    paragraphs: [
      "You confirm that you own the manuscript or hold all rights required to publish it. You retain ownership and grant Read the limited rights needed to store, review, display, and deliver it.",
      "You are responsible for metadata, pricing, cover rights, and legal compliance. Do not upload infringing, deceptive, unlawful, malicious, or prohibited material.",
      "Read may reject, hide, unfeature, or remove content and records moderation actions.",
    ],
  },
  community: {
    title: "Community Guidelines",
    paragraphs: [
      "Publish original work and submit reports in good faith. Do not use deceptive metadata or attempt to evade moderation.",
      "Copyright infringement, targeted abuse, exploitation, unlawful content, spam, malware, and payment-control evasion are prohibited.",
      "Administrators may dismiss reports, resolve them, temporarily hide a book, or permanently remove it.",
    ],
  },
} as const;

export type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;
