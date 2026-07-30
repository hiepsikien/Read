export const CURRENT_LEGAL_VERSION = "2026-07-30";

export type LegalDocumentId = "terms" | "privacy" | "publisher" | "community";

export const LEGAL_DOCUMENTS: Record<
  LegalDocumentId,
  { title: string; sections: Array<{ heading: string; body: string }> }
> = {
  terms: {
    title: "Terms of Use",
    sections: [
      {
        heading: "Using Read",
        body: "Use Read lawfully and respect the rights of readers, authors, and publishers. Accounts are personal. Do not abuse access controls, automate harmful traffic, or impersonate another person.",
      },
      {
        heading: "Eligibility",
        body: "You must be old enough to form a binding agreement under applicable law and the rules of the app store through which you access Read.",
      },
      {
        heading: "Enforcement",
        body: "Read may restrict content or accounts that violate these terms, the Community Guidelines, or applicable law. The service may change as the product develops.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "Data we use",
        body: "Read stores account identity, roles, manuscripts, purchases, moderation decisions, reports, and policy acceptance records needed to operate the service.",
      },
      {
        heading: "Content privacy",
        body: "Unpublished books are restricted to their publisher and administrators. Published books and covers are public inside Read. Reports are visible to administrators.",
      },
      {
        heading: "Providers",
        body: "Operational providers may process data for hosting, authentication, text-to-speech, and other product features. Read does not sell personal information.",
      },
    ],
  },
  publisher: {
    title: "Publisher Agreement",
    sections: [
      {
        heading: "Rights",
        body: "You confirm that you own the manuscript or hold all rights required to publish it. You retain ownership and grant Read the limited rights needed to store, review, display, and deliver it.",
      },
      {
        heading: "Responsibilities",
        body: "You are responsible for metadata, pricing, cover rights, and legal compliance. Do not upload infringing, deceptive, unlawful, malicious, or prohibited material.",
      },
      {
        heading: "Moderation",
        body: "Read may reject, hide, unfeature, or remove content. Moderation actions are recorded and serious or repeated violations may remove publishing access.",
      },
    ],
  },
  community: {
    title: "Community Guidelines",
    sections: [
      {
        heading: "Be genuine",
        body: "Publish original work and submit reports in good faith. Do not use deceptive metadata or attempt to evade moderation.",
      },
      {
        heading: "Prohibited content",
        body: "Copyright infringement, targeted abuse, exploitation, unlawful content, spam, malware, and payment-control evasion are prohibited.",
      },
      {
        heading: "Reports",
        body: "Administrators may dismiss reports, resolve them, temporarily hide a book, or permanently remove it.",
      },
    ],
  },
};
