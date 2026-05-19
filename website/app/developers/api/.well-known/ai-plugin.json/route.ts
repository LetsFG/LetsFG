import { NextRequest, NextResponse } from 'next/server'

import {
  buildPublicDeveloperAiPluginManifest,
  resolvePublicOrigin,
} from '../../../../../lib/public-developer-api'

export async function GET(request: NextRequest) {
  return NextResponse.json(buildPublicDeveloperAiPluginManifest(resolvePublicOrigin(request)), {
    headers: { 'Cache-Control': 'no-store' },
  })
}