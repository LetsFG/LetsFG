import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; slug?: string[] }> },
) {
  const { slug } = await params
  const suffix = slug && slug.length > 0 ? `/${slug.join('/')}` : ''
  const target = new URL(`/developers/docs${suffix}${request.nextUrl.search}`, request.url)
  target.hash = request.nextUrl.hash
  return NextResponse.redirect(target, 308)
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ locale: string; slug?: string[] }> },
) {
  return GET(request, context)
}