const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
}

const MCP_RESOURCE_URL =
  process.env.NEXT_PUBLIC_MCP_SERVER_URL || 'https://mcp.hypertask.ai/mcp'

export function GET(): Response {
  return Response.json(
    {
      resource: MCP_RESOURCE_URL,
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
