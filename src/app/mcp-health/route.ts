export function GET(): Response {
  return Response.json({
    status: 'ok',
    service: 'hypertasks-mcp',
    timestamp: new Date().toISOString(),
  })
}
