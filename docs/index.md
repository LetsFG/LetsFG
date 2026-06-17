---
hide:
  - toc
---

<section class="docs-hero">
  <div class="docs-hero-inner">
    <p class="docs-kicker">Official LetsFG documentation</p>
    <h1>Search hundreds of airlines server-side at letsfg.co. Free with a Bearer token. Move to the prepaid Developer API for direct booking URLs and volume access.</h1>
    <p class="docs-lead">LetsFG has two paths. If you installed the SDK, run <code>letsfg auth</code> once to get a free 90-day Bearer token and start searching. If you want account-managed access, direct airline booking URLs, or billing controls, use the developer surface on letsfg.co, attach Stripe, top up balance, and then search with your developer key.</p>
    <div class="docs-command"><span class="docs-command-prompt">$</span> pip install letsfg</div>
    <div class="docs-action-row">
      <a href="getting-started/" class="docs-button docs-button--primary">Get started</a>
      <a href="api-guide/" class="docs-button docs-button--ghost">Public API guide</a>
      <a href="https://letsfg.co/developers/api/docs" class="docs-button docs-button--ghost" target="_blank">Swagger</a>
      <a href="https://letsfg.co/en/developers" class="docs-button docs-button--ghost" target="_blank">Developers page</a>
    </div>
    <div class="docs-chip-row">
      <span class="docs-chip">Server-side search engine at letsfg.co</span>
      <span class="docs-chip">Canonical API at letsfg.co/developers/api</span>
      <span class="docs-chip">Free Bearer token or prepaid credits</span>
      <span class="docs-chip">CLI, SDK, and MCP</span>
    </div>
  </div>
</section>

## Two paths to LetsFG

LetsFG has two access paths — pick the one that matches your setup:

| Path | How | Speed | Search cost | Booking URL |
|------|-----|-------|-------------|-------------|
| **CLI / SDK** (`letsfg auth`) | Server-side search via the letsfg.co engine; one-time Twitter/X challenge → 90-day Bearer token | 60–90 s | Free | 1% concierge fee (min $3) via letsfg.co |
| **Developer API** ([letsfg.co/developers](https://letsfg.co/developers)) | Runs on our servers with prepaid credits | 2–5 s (discover) · 60–90 s (full search) | Prepaid credits | Direct airline booking URLs, no per-booking fee |

**When to choose each:**
- Use **CLI / SDK** if you want free search — run `letsfg auth` once for a 90-day Bearer token ([letsfg.co/for-agents](https://letsfg.co/for-agents)), then search server-side for free. The concierge unlock flow delivers the direct airline URL after a 1% fee (min $3).
- Use the **Developer API** if you're building a product or need high volume without per-booking fees. Prepaid credits, results in seconds, direct airline URLs every time.

---

## Pick your lane

<div class="docs-mode-grid">
  <article class="docs-mode-card">
    <p class="docs-card-kicker">CLI / SDK mode</p>
    <h2>Search free after a one-time auth step</h2>
    <p>Use this path after installing the SDK. Run <code>letsfg auth</code> once to complete the Twitter/X challenge and get a 90-day Bearer token. All search runs server-side at letsfg.co — no local browsers required.</p>
    <ul class="docs-check-list">
      <li><code>letsfg search</code> and <code>bt.search()</code> work with the Bearer token</li>
      <li>Search is free and unlimited for the 90-day token lifetime</li>
      <li>Best for prototyping, agents, and general flight search</li>
    </ul>
    <a href="getting-started/#option-a-free-search-with-bearer-token" class="docs-text-link">Go to setup</a>
  </article>

  <article class="docs-mode-card">
    <p class="docs-card-kicker">Public developer API</p>
    <h2>Use the website-owned contract</h2>
    <p>Use this when you want managed cloud search, billing controls, the public OpenAPI contract, or hosted onboarding through letsfg.co.</p>
    <ul class="docs-check-list">
      <li>Register first and keep the returned <code>X-API-Key</code></li>
      <li>Attach a Stripe payment method for browserless or hosted onboarding</li>
      <li>Fund prepaid balance before flight search is enabled</li>
    </ul>
    <a href="api-guide/" class="docs-text-link">Go to public API guide</a>
  </article>
</div>

<div class="docs-callout">
  <strong>Important:</strong> the public developer API is not anonymous search. Search requests are rejected until the developer account has an API key, a payment method, and funded prepaid balance.
</div>

## Public API onboarding

<div class="docs-step-strip">
  <span class="docs-step">1. Register</span>
  <span class="docs-step-arrow">/</span>
  <span class="docs-step">2. Attach Stripe payment</span>
  <span class="docs-step-arrow">/</span>
  <span class="docs-step">3. Top up balance</span>
  <span class="docs-step-arrow">/</span>
  <span class="docs-step">4. Search</span>
  <span class="docs-step-arrow">/</span>
  <span class="docs-step">5. Check account state</span>
</div>

The canonical public surfaces are:

- API root: [letsfg.co/developers/api](https://letsfg.co/developers/api)
- OpenAPI JSON: [letsfg.co/developers/api/openapi.json](https://letsfg.co/developers/api/openapi.json)
- Swagger UI: [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

## Start from the right page

<div class="docs-resource-grid">
  <a class="docs-resource-card" href="getting-started/">
    <p class="docs-card-kicker">Start</p>
    <h3>Getting started</h3>
    <p>Install once, choose the correct mode, and run the first search without mixing local and public flows.</p>
  </a>

  <a class="docs-resource-card" href="api-guide/">
    <p class="docs-card-kicker">Contract</p>
    <h3>Public API overview</h3>
    <p>See the canonical URLs, the paid search lifecycle, and the exact pages to follow for onboarding, search, and errors.</p>
  </a>

  <a class="docs-resource-card" href="api-onboarding/">
    <p class="docs-card-kicker">Billing</p>
    <h3>Onboarding and billing</h3>
    <p>Register, attach Stripe, top up prepaid balance, open the billing portal, and rotate keys safely.</p>
  </a>

  <a class="docs-resource-card" href="api-search/">
    <p class="docs-card-kicker">Search</p>
    <h3>Search and results</h3>
    <p>Resolve locations, build search payloads, understand passenger IDs, and store the fields you actually need.</p>
  </a>

  <a class="docs-resource-card" href="api-errors/">
    <p class="docs-card-kicker">Ops</p>
    <h3>Errors and limits</h3>
    <p>Map account state to 401, 402, 403, 409, and 429 responses before you ship the paid API flow.</p>
  </a>

  <a class="docs-resource-card" href="openapi/">
    <p class="docs-card-kicker">Schema</p>
    <h3>OpenAPI and Swagger</h3>
    <p>Use the website-owned machine-readable schema instead of the old raw repository copy.</p>
  </a>

  <a class="docs-resource-card" href="packages/">
    <p class="docs-card-kicker">Tooling</p>
    <h3>Packages and SDKs</h3>
    <p>See what ships in the Python SDK, JS SDK, local MCP server, and remote MCP endpoint without mixing their search modes.</p>
  </a>

  <a class="docs-resource-card" href="agent-guide/">
    <p class="docs-card-kicker">Agents</p>
    <h3>AI agent guide</h3>
    <p>Build agents that use the Bearer token for free search and the Developer API when managed cloud access matters.</p>
  </a>

  <a class="docs-resource-card" href="cli-reference/">
    <p class="docs-card-kicker">CLI</p>
    <h3>CLI reference</h3>
    <p>Check command flags, environment variables, and how the CLI maps to local and public flows.</p>
  </a>
</div>
