import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'

const SUPPORTED_LOCALES = new Set([
  'en',
  'pl',
  'de',
  'es',
  'fr',
  'it',
  'pt',
  'nl',
  'sq',
  'hr',
  'sv',
  'ja',
  'zh',
])

const LAST_UPDATED = 'May 16, 2026'
const SUPPORT_EMAIL = 'contact@letsfg.co'
const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`
const COMPANY_NAME = 'Mental Balance Sp. z o.o.'
const COMPANY_ADDRESS = 'Szafera 1/14, 31-543 Krakow, Lesser Poland Voivodeship, Poland'
const COMPANY_VAT = 'PL6751772427'

type Anchor = {
  id: string
  label: string
}

type LegalShellProps = {
  locale: string
  title: string
  summary: string
  children: ReactNode
}

export const privacyMetadata: Metadata = {
  title: 'Privacy Policy | LetsFG',
  description:
    'How LetsFG handles anonymous search sessions, payment-related data, cookies, analytics, and service communications.',
}

export const termsMetadata: Metadata = {
  title: 'Terms of Service | LetsFG',
  description:
    'The terms governing LetsFG search, monitor, unlock, and booking-assistance services, including the personal-agent model.',
}

export function resolveLegalLocale(value: string | null | undefined): string {
  return value && SUPPORTED_LOCALES.has(value) ? value : 'en'
}

function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="legal-section-block">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function LegalNote({ children }: { children: ReactNode }) {
  return <div className="legal-note">{children}</div>
}

function LegalShell({
  locale,
  title,
  summary,
  children,
}: LegalShellProps) {
  return (
    <main className="lp-root legal-page">
      <header className="legal-header">
        <div className="legal-shell legal-header-inner">
          <Link href={`/${locale}`} className="legal-brand-link" aria-label="LetsFG home">
            <Image
              src="/lfg_ban.png"
              alt="LetsFG"
              width={4990}
              height={1560}
              className="legal-brand"
              priority
              sizes="(max-width: 768px) 180px, 260px"
            />
          </Link>
        </div>
      </header>

      <article className="legal-shell legal-document">
        <p className="legal-kicker">Legal</p>
        <h1 className="legal-title">{title}</h1>
        <p className="legal-summary">{summary}</p>
        <div className="legal-meta">
          <p><strong>Last updated:</strong> {LAST_UPDATED}</p>
          <p><strong>Operator:</strong> LetsFG is a brand operated by {COMPANY_NAME}</p>
          <p><strong>Address:</strong> {COMPANY_ADDRESS}</p>
          <p><strong>VAT:</strong> {COMPANY_VAT}</p>
          <p><strong>Contact:</strong> <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a></p>
        </div>
        <div className="legal-content">{children}</div>
      </article>

      <footer className="legal-footer">
        <div className="legal-shell legal-footer-inner">
          <Link href={`/${locale}`} className="legal-footer-link">
          Home
        </Link>
          <Link href={`/${locale}/terms`} className="legal-footer-link">
          Terms
        </Link>
          <Link href={`/${locale}/privacy`} className="legal-footer-link">
          Privacy
        </Link>
          <a href={SUPPORT_MAILTO} className="legal-footer-link">
          Support
        </a>
        </div>
      </footer>
    </main>
  )
}

export function PrivacyPolicyPage({ locale }: { locale: string }) {
  return (
    <LegalShell
      locale={locale}
      title="Search tracking without turning people into profiles."
      summary="LetsFG is designed so that ordinary flight searches are tied to anonymous sessions, not named accounts. This policy explains what data we process, how the personal-agent model works, and what actually changes when you pay, ask for alerts, or ask us to contact you."
    >
      <LegalSection id="controller" title="1. Who controls your data?">
        <p>
          LetsFG is the public brand operated by {COMPANY_NAME}, VAT {COMPANY_VAT}, with its registered address at {COMPANY_ADDRESS}.
          For data protection purposes, {COMPANY_NAME} is the controller of personal data processed through letsfg.co and related
          service channels.
        </p>
        <p>
          You can contact us about privacy questions, requests, or complaints at <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection id="agent-model" title="2. How the personal agent model works">
        <p>
          LetsFG does not operate like a passive list of links. When you submit a search, we activate a software agent that acts
          on your behalf and according to your instructions. That agent uses your travel requirements to query airlines, OTAs,
          booking sites, and related travel interfaces, compare options, and surface the results that best match your criteria.
        </p>
        <p>
          Because the service is acting for you, we must process the search instructions you provide and the technical data needed
          to run that search across third-party supplier systems. The point of that processing is to help you choose the option
          that best fits your requirements, not to build an advertising profile around you.
        </p>
        <LegalNote>
          Searches on LetsFG are anonymous in the ordinary course. We track search activity and product usage through anonymous
          session identifiers and telemetry, not through named user accounts.
        </LegalNote>
      </LegalSection>

      <LegalSection id="search-data" title="3. What we collect during search">
        <p>When you search or browse results, we may process:</p>
        <ul className="legal-list">
          <li>Your travel instructions, such as origin, destination, dates, passenger counts, cabin preferences, filters, and other request details.</li>
          <li>Anonymous session and device data, such as cookies, session identifiers, user agent, request timestamps, and network or IP-derived signals used for security, routing, abuse prevention, and rate limiting.</li>
          <li>Preference data, such as selected language, currency, and search or results interactions.</li>
          <li>Internal telemetry about the search itself, including what sources were queried, what results were viewed, and what actions were taken on the site.</li>
          <li>Website analytics data, including page view and navigation measurement through tools such as Google Analytics and our own search-session analytics pipeline.</li>
        </ul>
        <p>
          We intentionally structure ordinary searches so we do not need your name, passenger identity, or a permanent account in
          order to show results. We may still process technical identifiers needed to operate and secure the site, but those are
          used to keep the service working rather than to identify you by name.
        </p>
      </LegalSection>

      <LegalSection id="payment-data" title="4. What changes when you pay or share contact details">
        <p>
          If you pay for an unlock, monitoring product, or another paid feature, payment entry happens on Stripe-hosted checkout
          pages or through Stripe-managed payment flows. We do not receive or store your full payment card number, card security
          code, or full authentication credentials.
        </p>
        <p>
          Stripe may share limited payment-related information with us when needed to confirm the transaction and meet accounting,
          tax, support, or anti-fraud obligations. Depending on the flow, that can include your billing name, billing address,
          email address, country, transaction identifiers, and payment status.
        </p>
        <p>
          If you ask us to deliver alerts or service messages, we may process the contact channel you provide, including an email
          address, push subscription details, or Telegram identifier. If a booking or support flow requires passenger or contact
          details, we process those details only to carry out that flow or respond to your request.
        </p>
        <LegalNote>
          We may contact you after payment or during service delivery if we need to confirm an instruction, resolve a payment or
          supplier issue, deliver an alert or unlock, prevent fraud, or comply with law. We do not use those contact details for
          promotional outreach unless you separately choose to receive it.
        </LegalNote>
      </LegalSection>

      <LegalSection id="use-bases" title="5. How and why we use data">
        <p>We use personal data only where we have a valid reason to do so, including to:</p>
        <ul className="legal-list">
          <li>operate the LetsFG personal-agent service and return search, unlock, monitor, or booking-assistance results;</li>
          <li>process and verify payments, including tying a Stripe payment back to the anonymous session that initiated it;</li>
          <li>send service messages, alerts, support replies, and operational follow-ups;</li>
          <li>secure the site, prevent abuse, investigate fraud, enforce limits, and maintain logs necessary for reliability;</li>
          <li>measure usage, improve the product, and understand aggregate search behavior;</li>
          <li>comply with accounting, tax, regulatory, and legal obligations.</li>
        </ul>
        <p>Our main legal bases under applicable privacy law are:</p>
        <ul className="legal-list">
          <li>performance of a contract or steps taken at your request before entering into a contract;</li>
          <li>our legitimate interests in operating, securing, and improving the service;</li>
          <li>compliance with legal obligations; and</li>
          <li>your consent, where consent is legally required.</li>
        </ul>
      </LegalSection>

      <LegalSection id="sharing" title="6. Who we share data with">
        <p>We share data only where that is needed to run the service or where law requires it. Recipients may include:</p>
        <ul className="legal-list">
          <li>airlines, OTAs, booking systems, and other travel suppliers queried or used by the personal agent while carrying out your instructions;</li>
          <li>Stripe and other payment or anti-fraud providers involved in processing and validating a transaction;</li>
          <li>hosting, cloud, analytics, communications, and infrastructure vendors who help us run letsfg.co;</li>
          <li>professional advisers, auditors, regulators, courts, or law-enforcement bodies where required or appropriate.</li>
        </ul>
        <p>
          We do not sell your personal data, and we do not use your search history to create advertising audiences or to inflate
          prices because you searched twice.
        </p>
        <p>
          Some of our processors or suppliers may operate outside your country or outside the EEA. Where required, we rely on
          contractual or other lawful safeguards for international transfers.
        </p>
      </LegalSection>

      <LegalSection id="retention-rights" title="7. Retention and your rights">
        <p>
          We keep data only for as long as it is reasonably needed for the purposes above. Anonymous search telemetry and security
          logs may be retained for operations, debugging, analytics, and abuse prevention. Payment and accounting records may be
          retained longer where tax, bookkeeping, or dispute-resolution rules require it. Cookies and local preferences may remain
          until they expire or you clear them from your browser.
        </p>
        <p>
          Subject to applicable law, you may have the right to request access to your personal data, correction, deletion,
          restriction, portability, or objection, and to withdraw consent where consent is the legal basis. You may also lodge a
          complaint with your local supervisory authority.
        </p>
        <p>
          To exercise a privacy right or ask a question, contact <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>. We may need enough
          information from you to verify the request and locate the relevant records.
        </p>
      </LegalSection>
    </LegalShell>
  )
}

export function TermsPage({ locale }: { locale: string }) {
  return (
    <LegalShell
      locale={locale}
      title="The rules for using a personal flight-search agent on LetsFG."
      summary="These terms explain what LetsFG is, what you authorize us to do when you search, how payments and third-party suppliers fit into the flow, and what both sides are responsible for when you use the service."
    >
      <LegalSection id="acceptance" title="1. Who we are and when these terms apply">
        <p>
          These Terms of Service govern your use of letsfg.co and related LetsFG search, unlock, monitoring, and booking-assistance
          features. LetsFG is the trading brand of {COMPANY_NAME}, VAT {COMPANY_VAT}, registered at {COMPANY_ADDRESS}.
        </p>
        <p>
          By using the site or any LetsFG service, you agree to these terms. If you do not agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection id="authorization" title="2. Personal-agent authorization">
        <p>
          LetsFG is not merely a passive directory of travel websites. When you submit a search or other instruction, you ask us
          to provide a personal software agent that acts in your name and on your behalf to search, compare, and help you choose
          travel options that match your requirements.
        </p>
        <p>That authorization includes, as needed to deliver the service:</p>
        <ul className="legal-list">
          <li>querying airline, OTA, booking, and travel-related websites, APIs, and interfaces;</li>
          <li>processing your requirements, filters, timing constraints, and preferences;</li>
          <li>ranking, presenting, unlocking, or otherwise surfacing options that appear to fit the instructions you gave us.</li>
        </ul>
        <p>
          You authorize this activity only for the purpose of delivering the LetsFG service to you. You remain responsible for any
          final travel decision you make.
        </p>
      </LegalSection>

      <LegalSection id="user-data" title="3. Your responsibilities and accurate information">
        <p>
          You must provide accurate, complete, and lawful information when using LetsFG. That includes honest search requirements,
          correct contact details, and, where a booking or supplier flow requires it, real passenger details that match the
          relevant travel documents.
        </p>
        <ul className="legal-list">
          <li>If a booking flow requires an email address, use the real passenger or contact email address that should receive the ticket or service notices.</li>
          <li>If a supplier requires legal names, dates of birth, or other traveler data, those details must be accurate and match the passenger's official documents.</li>
          <li>You must be legally able to authorize the search or purchase and to accept these terms for yourself or for anyone on whose behalf you act.</li>
        </ul>
      </LegalSection>

      <LegalSection id="suppliers" title="4. Search results, pricing, and supplier terms">
        <p>
          LetsFG tries to surface real offers and better matches, but airlines, OTAs, booking systems, and other suppliers control
          their own inventory, availability, schedules, ancillaries, and final contract terms. Search results can change, expire,
          or disappear between search, unlock, and booking.
        </p>
        <p>
          Unless expressly stated otherwise, the underlying transportation or travel product is supplied by the airline, OTA, or
          other provider you ultimately choose. Their own terms, conditions, baggage rules, refund rules, and operational policies
          also apply.
        </p>
        <LegalNote>
          LetsFG can help you identify the option that best fits your requirements, but it cannot guarantee that a third-party
          supplier will keep the same price, inventory, or conditions until the transaction is fully confirmed.
        </LegalNote>
      </LegalSection>

      <LegalSection id="payments" title="5. Fees, payments, and contact after payment">
        <p>
          Some LetsFG features are free, while others may involve a fee that is shown before you confirm payment. Payments are
          processed through Stripe or another stated payment provider. We do not collect or store your full card number, card
          security code, or equivalent authentication data.
        </p>
        <p>
          By completing a payment, you authorize the stated charge for the relevant LetsFG service. Any refund rights that apply
          will be the ones stated at checkout or required by mandatory law.
        </p>
        <p>
          After payment, we may contact you using the email address or other service channel linked to the transaction if we need
          to verify details, resolve a supplier or payment issue, deliver the purchased feature, provide support, or meet legal
          obligations. We do not use those service details for promotional messaging unless you separately opt in.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="6. Acceptable use and intellectual property">
        <p>
          You may use LetsFG only for lawful purposes and in a way that does not interfere with the platform, our suppliers, or
          other users. You must not misuse the service, attempt to circumvent security or payment controls, scrape or extract data
          from the site beyond permitted use, or use LetsFG to violate third-party rights or laws.
        </p>
        <p>
          The LetsFG brand, site design, software, copy, and related intellectual property remain owned by us or our licensors.
          We grant you a limited, non-exclusive, revocable right to use the service for its intended purpose under these terms.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="7. Availability, disclaimers, and liability">
        <p>
          LetsFG is provided on an "as available" basis. We may update, suspend, or remove features at any time. To the maximum
          extent permitted by law, we do not guarantee uninterrupted availability or that every search will return a result,
          complete a payment, or lead to a successful supplier transaction.
        </p>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive
          losses, or for losses caused by supplier actions, price changes, inventory changes, travel disruption, or external site
          failures. Our total liability arising out of the relevant service will not exceed the amount you paid to us for that
          service in the 12 months before the claim arose.
        </p>
        <p>
          Nothing in these terms excludes or limits liability that cannot lawfully be excluded, and nothing removes mandatory
          consumer rights that apply to you under relevant law.
        </p>
      </LegalSection>

      <LegalSection id="law-contact" title="8. Law, changes, and contact">
        <p>
          We may update these terms from time to time by posting a revised version on this site. The updated version will apply
          from the date shown at the top of the page.
        </p>
        <p>
          These terms are governed by the laws of Poland, without prejudice to any mandatory consumer protections that apply in
          your country of residence. If a dispute cannot be resolved informally, the competent courts of Poland will have
          jurisdiction unless mandatory law gives you the right to bring the claim elsewhere.
        </p>
        <p>
          Questions, complaints, or legal notices can be sent to <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a> or by post to {COMPANY_NAME}, {COMPANY_ADDRESS}.
        </p>
      </LegalSection>
    </LegalShell>
  )
}