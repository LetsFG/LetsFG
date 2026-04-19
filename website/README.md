# LetsFG Website

The consumer-facing flight search website for LetsFG.

## Architecture

- **Homepage** (`/`) — Single search input, natural language
- **Results** (`/results/{search_id}`) — Server-rendered results page with agent-readable content

### Agent-Native Design

Every page includes hidden structured content for AI agents:

```html
<section class="sr-only" data-agent-content>
  <!-- Machine-readable summary, instructions, data tables -->
</section>
```

The results page uses `<meta http-equiv="refresh">` while searching, so agent browsers automatically reload until results are ready.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deployment

Build for production:

```bash
npm run build
```

Deploy to Cloud Run:

```bash
gcloud run deploy letsfg-website \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated
```

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Server-side rendering for results pages
- Calls LetsFG API for actual flight search
