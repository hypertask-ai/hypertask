const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
}

export function GET(request: Request): Response {
  const host = request.headers.get('host') ?? new URL(request.url).host
  return Response.json(
    {
      resource: `https://${host}`,
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
