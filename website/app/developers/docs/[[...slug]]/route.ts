import { promises as fs } from 'fs'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const DOCS_ROOT = path.resolve(process.cwd(), 'public', 'developers', 'docs')

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

function safeResolve(...segments: string[]) {
  const filePath = path.resolve(DOCS_ROOT, ...segments)
  const relative = path.relative(DOCS_ROOT, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }
  return filePath
}

async function findExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    const filePath = safeResolve(candidate)
    if (!filePath) {
      continue
    }

    try {
      const stat = await fs.stat(filePath)
      if (stat.isFile()) {
        return filePath
      }
    } catch {
      continue
    }
  }

  return null
}

function buildCandidates(slug: string[] | undefined) {
  const normalizedSlug = (slug || []).filter(Boolean)

  if (normalizedSlug.length === 0) {
    return ['index.html']
  }

  const requestedPath = path.join(...normalizedSlug)
  if (path.extname(requestedPath)) {
    return [requestedPath]
  }

  return [path.join(requestedPath, 'index.html'), `${requestedPath}.html`]
}

function cacheControlFor(filePath: string) {
  return path.extname(filePath) === '.html'
    ? 'public, max-age=300, must-revalidate'
    : 'public, max-age=86400, must-revalidate'
}

function contentTypeFor(filePath: string) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

async function serveDocs(
  _request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
  method: 'GET' | 'HEAD',
) {
  const { slug } = await params
  const candidates = buildCandidates(slug)
  const filePath = await findExistingFile(candidates)

  if (!filePath) {
    const notFoundPage = await findExistingFile(['404.html'])
    if (!notFoundPage) {
      return new NextResponse('Not found', { status: 404 })
    }

    const body = method === 'HEAD' ? null : await fs.readFile(notFoundPage)
    return new NextResponse(body, {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=300, must-revalidate',
        'Content-Type': 'text/html; charset=utf-8',
      },
    })
  }

  const body = method === 'HEAD' ? null : await fs.readFile(filePath)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Cache-Control': cacheControlFor(filePath),
      'Content-Type': contentTypeFor(filePath),
    },
  })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return serveDocs(request, context, 'GET')
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return serveDocs(request, context, 'HEAD')
}