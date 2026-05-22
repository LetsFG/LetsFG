import { NextResponse } from 'next/server'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'

// Returns a plain-text robots.txt with llms.txt and agent guide references.
// We hand-craft this as a string so we can include the AI-agent hints that
// the Next.js MetadataRoute.Robots type does not support.
export async function GET() {
  const body = [
    `# robots.txt — ${SITE_URL}`,
    ``,
    `# AI agents and language models: see the agent guide before using browser`,
    `# automation. You can search natively via plain HTTP — no browser needed.`,
    `# Agent guide:  ${SITE_URL}/for-agents`,
    `# LLM instructions (llms.txt): ${SITE_URL}/llms.txt`,
    ``,
    `User-agent: *`,
    `Allow: /`,
    `Disallow: /api/`,
    `Disallow: /book/`,
    `Disallow: /results/`,
    ``,
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    `Sitemap: ${SITE_URL}/sitemap-flights.xml`,
    ``,
    `Host: ${SITE_URL}`,
  ].join('\n')

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}