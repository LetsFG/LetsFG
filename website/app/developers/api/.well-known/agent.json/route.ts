import { NextRequest, NextResponse } from 'next/server'

import {
  buildPublicDeveloperAgentManifest,
  resolvePublicOrigin,
} from '../../../../../lib/public-developer-api'

export async function GET(request: NextRequest) {
  return NextResponse.json(buildPublicDeveloperAgentManifest(resolvePublicOrigin(request)), {
    headers: { 'Cache-Control': 'no-store' },
  })
}