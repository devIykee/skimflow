import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Skimflow",
  description: "The terms governing use of Skimflow: payments, refunds, reporting, content, and revenue split.",
};

// NOTE: This is a product-accurate DRAFT, not legal advice. It must be reviewed
// by a qualified lawyer (Nigerian consumer-protection + any applicable
// crypto/fintech regulation, given the USDC/stablecoin rails and primary user
// base) before being treated as binding. The age minimum (18+) and governing
// jurisdiction (Nigeria) below are assumptions flagged for that review.

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 font-headline-sm text-headline-sm text-on-surface">
        {n}. {title}
      </h2>
      <div className="flex flex-col gap-2 font-body-md text-body-md text-on-surface-variant">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-margin-mobile py-stack-lg md:px-margin-desktop">
      <h1 className="mb-2 font-display-lg text-display-lg-mobile md:text-display-lg">Terms of Service</h1>
      <p className="mb-6 font-body-sm text-body-sm text-outline">Last updated: draft, pending legal review.</p>

      <div className="mb-8 rounded-xl border border-primary/40 bg-primary/5 p-4">
        <div className="mb-1 flex items-center gap-2 font-label-lg text-primary">
          <span className="material-symbols-outlined text-[18px]">gavel</span>
          Draft: not yet legally binding
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          This document is a starting draft that reflects how Skimflow works. It has not been reviewed by a lawyer and
          is not yet binding. It must be checked against applicable consumer-protection and crypto/fintech regulation
          (the platform&apos;s primary user base is Nigeria-based) before publication. The minimum age (18+) and
          governing jurisdiction (Nigeria) stated below are assumptions pending that review.
        </p>
      </div>

      <Section n="1" title="What Skimflow is">
        <p>
          Skimflow lets creators publish content that readers unlock and pay for in small amounts of USDC, settled on
          the Arc network via Circle Gateway. Content may be a chunked article (paid per block), an Agent Skill, or a
          Picture Skimflow (paid per image).
        </p>
      </Section>

      <Section n="2" title="Payment model">
        <p>
          You pay per block (for articles) or per image (for Skimflow). To make reading seamless, unlocking is{" "}
          <strong>optimistic</strong>: content may be shown to you before its payment is fully confirmed on-chain, with
          the payment settling in the background. The final block or image of a piece is always confirmed before it is
          shown.
        </p>
        <p>
          If a payment fails and is not resolved (for example, because your balance is insufficient), we may restrict
          further unlocking of that content until the outstanding amount is settled. Content you have already unlocked
          stays available to you.
        </p>
      </Section>

      <Section n="3" title="No refunds by default, with a broken-link exception">
        <p>
          Completed unlocks are generally <strong>non-refundable</strong>. The one exception: if a paid Skimflow image
          becomes unavailable because its externally-hosted link is dead or unshared, you may file a report (see below)
          for review. Resolution (refund, credit, or otherwise) is at the platform&apos;s discretion following that
          review. Filing a report does not guarantee a refund; it guarantees the issue is reviewed.
        </p>
      </Section>

      <Section n="4" title="Reporting">
        <p>
          You can report a broken paid image, or report any content for issues such as copyright infringement, scams, or
          inappropriate material. Reports are reviewed by our team through an internal process. Filing a report does not
          guarantee a specific outcome.
        </p>
      </Section>

      <Section n="5" title="Content locking after payment">
        <p>
          Once readers have paid to unlock a specific chunk or image, that content is protected: creators cannot
          substantively alter or delete it at will. Removal of paid content requires an explicit confirmation and is
          recorded for review, and heavily-purchased content can only be removed by the platform. This protects what you
          paid to access.
        </p>
      </Section>

      <Section n="6" title="Externally-hosted content">
        <p>
          Skimflow images are added by creators as links to externally-hosted files (for example, Google Drive), not
          uploaded to Skimflow. We do not control or guarantee the continued availability of externally-hosted content.
          Creators are responsible for keeping their linked content accessible; our liability for content becoming
          unavailable is limited to the report/review process described above.
        </p>
      </Section>

      <Section n="7" title="Creator responsibilities">
        <p>
          Creators are responsible for ensuring the content they publish or import (including Medium-imported and
          GitHub-imported content) is their own or appropriately licensed, and for the accuracy of any Agent Skill they
          publish. Creators must hold a valid payout wallet to publish.
        </p>
      </Section>

      <Section n="8" title="Revenue split">
        <p>
          The platform takes a cut of every transaction. The standard split is 80% to the creator, 12% to the platform,
          5% to a referrer (folded into the reserve when there is no referrer), and 3% to a reserve. Creators receive the
          remainder after these shares.
        </p>
      </Section>

      <Section n="9" title="Eligibility and accounts">
        <p>
          You must be at least 18 years old (subject to legal review) to hold an embedded wallet and transact on
          Skimflow. You are responsible for activity under your account. We may suspend or terminate accounts that
          violate these terms or applicable law.
        </p>
      </Section>

      <Section n="10" title="Prohibited use">
        <p>
          Do not use Skimflow to publish unlawful content, infringe others&apos; rights, defraud readers, launder funds,
          or circumvent the payment system. We may remove content and restrict accounts that do.
        </p>
      </Section>

      <Section n="11" title="Limitation of liability">
        <p>
          Skimflow is provided &quot;as is.&quot; To the maximum extent permitted by law, we are not liable for indirect
          or consequential losses, for the availability or content of externally-hosted material, or for losses arising
          from on-chain transactions you authorize.
        </p>
      </Section>

      <Section n="12" title="Governing law and disputes">
        <p>
          These terms are intended to be governed by the laws of Nigeria, with disputes resolved in the appropriate
          Nigerian courts (pending legal review and confirmation of the correct jurisdiction for the platform&apos;s
          operations and user base).
        </p>
      </Section>

      <Section n="13" title="Changes to these terms">
        <p>
          We may update these terms. Material changes will be reflected by updating the date above; continued use after a
          change constitutes acceptance of the updated terms.
        </p>
      </Section>
    </div>
  );
}
