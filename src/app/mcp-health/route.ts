import { withoutAuth } from "#with-auth";
// Health probe for the MCP server routes. mcp.hypertask.ai/health rewrites here
// (see src/proxy.ts) to match the retired standalone server's unauthenticated probe.
function GETHandler(): Response {
  return Response.json({
    status: 'ok',
    service: 'hypertasks-mcp',
    timestamp: new Date().toISOString(),
  })
}

export const GET = withoutAuth(GETHandler);
