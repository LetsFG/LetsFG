import { NextRequest } from 'next/server'

import { proxyPublicDeveloperMcp } from '../../../../../lib/public-developer-mcp'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return proxyPublicDeveloperMcp(request, '/mcp/messages')
}