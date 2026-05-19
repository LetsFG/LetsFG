import { NextRequest } from 'next/server'

import { proxyPublicDeveloperMcp } from '../../../../../lib/public-developer-mcp'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return proxyPublicDeveloperMcp(request, '/mcp/sse')
}