import { getMcpRequestOrigin, MCP_RESOURCE_URL } from '@/lib/mcp-server/resource-url'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
}

export async function GET(request: Request): Promise<Response> {
  const origin = await getMcpRequestOrigin(request)
  return Response.json(
    {
      resource: origin ? `${origin}/mcp` : MCP_RESOURCE_URL,
      authorization_servers: ['https://app.hypertask.ai'],
      scopes_supported: ['mcp:full'],
      bearer_methods_supported: ['header'],
    },
    { headers: corsHeaders }
  )
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
