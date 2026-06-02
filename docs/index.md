---
hide:
  - toc
---

<section class="docs-hero">
  <div class="docs-hero-inner">
    <p class="docs-kicker">Official LetsFG documentation</p>
    <h1>Start with free local connector search. Move to the prepaid public API only when you need managed cloud access.</h1>
    <p class="docs-lead">LetsFG now has a clean split. If you cloned the repo or installed the SDK, search locally right away. If you want account-managed website API access, use the developer surface on letsfg.co, attach Stripe, top up balance, and then search with your developer key.</p>
    <div class="docs-command"><span class="docs-command-prompt">$</span> pip install letsfg</div>
    <div class="docs-action-row">
      <a href="getting-started/" class="docs-button docs-button--primary">Get started</a>
      <a href="api-guide/" class="docs-button docs-button--ghost">Public API guide</a>
      <a href="https://letsfg.co/developers/api/docs" class="docs-button docs-button--ghost" target="_blank">Swagger</a>
      <a href="https://letsfg.co/en/developers" class="docs-button docs-button--ghost" target="_blank">Developers page</a>
    </div>
    <div class="docs-chip-row">
      <span class="docs-chip">200+ local connectors</span>
      <span class="docs-chip">Canonical API at letsfg.co/developers/api</span>
      <span class="docs-chip">Prepaid public search</span>
      <span class="docs-chip">CLI, SDK, and MCP</span>
    </div>
  </div>
</section>

## Three paths to LetsFG

LetsFG has three distinct access paths — pick the one that matches your setup:

| Path | How | Speed | Search cost | Booking URL |
|------|-----|-------|-------------|-------------|
| **1 — Local** (CLI / SDK / MCP-local) | 200+ connectors run on your machine via Playwright | 20–40 s (fast mode) · 1–15 min (full) | Free | 1% concierge fee (min $3) via letsfg.co |
| **2 — PFS** (Programmatic Flight Search via letsfg.co) | Server-side search via the letsfg.co engine; one-time Twitter/X challenge → 90-day Bearer token | 60–90 s | Free (Twitter/X token) | 1% concierge fee (min $3) via letsfg.co |
| **3 — Developer API** ([letsfg.co/developers](https://letsfg.co/developers)) | Runs on our servers with prepaid credits | 2–5 s (discover) · 60–90 s (full search) | Prepaid credits | Direct airline booking URLs, no per-booking fee |

**When to choose each:**
- Use **Path 1** if you can run a local browser — search is free and unlimited. Booking links go through the same letsfg.co concierge checkout as Path 2 (1% fee, min $3).
- Use **Path 2 (PFS)** if you're an AI agent (Claude, GPT, OpenClaw, etc.) that can't run local browsers. Register a free 90-day Bearer token via a one-time Twitter/X challenge ([letsfg.co/for-agents](https://letsfg.co/for-agents)), then search server-side. The concierge unlock flow delivers the direct airline URL after a 1% fee (min $3).
- Use **Path 3** if you're building a product or need high volume without per-booking fees. Prepaid credits, results in seconds, direct airline URLs every time.

---

## Pick your lane

<div class="docs-mode-grid">
  <article class="docs-mode-card">
    <p class="docs-card-kicker">Local mode</p>
    <h2>Search immediately after install</h2>
    <p>Use this path if you installed the SDK or cloned the repo. The default CLI and local Python helpers run connectors on your machine and stay free.</p>
    <ul class="docs-check-list">
      <li><code>letsfg search</code> and <code>search_local()</code> work without signup</li>
      <li>Local telemetry can still report analytics in the background</li>
      <li>Best for prototyping, connector debugging, and broad local sweeps</li>
    </ul>
    <a href="getting-started/#option-a-free-local-search" class="docs-text-link">Go to local setup</a>
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
    <p>Build agents that use local search for cheap exploration and the public API when managed cloud access matters.</p>
  </a>

  <a class="docs-resource-card" href="cli-reference/">
    <p class="docs-card-kicker">CLI</p>
    <h3>CLI reference</h3>
    <p>Check command flags, environment variables, and how the CLI maps to local and public flows.</p>
  </a>
</div>
