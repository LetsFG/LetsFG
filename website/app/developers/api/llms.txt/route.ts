import { NextRequest, NextResponse } from 'next/server'

import { buildPublicDeveloperLlmsText, resolvePublicOrigin } from '../../../../lib/public-developer-api'

export async function GET(request: NextRequest) {
  return new NextResponse(buildPublicDeveloperLlmsText(resolvePublicOrigin(request)), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}