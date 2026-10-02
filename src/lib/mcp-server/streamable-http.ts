import { createMcpHandler } from 'mcp-handler'
import crypto from 'node:crypto'
import { MCP_SERVER_INFO, type PortableTool } from './stateless-http'

export function bindMcpTools(tools: readonly PortableTool[]) {
  return createMcpHandler(
    (server) => {
      for (const tool of tools) {
        server.registerTool(tool.name, {
          description: tool.description,
          inputSchema: tool.parameters,
        }, async (args, extra) => {
          const token = extra.http?.authInfo?.token
          if (!token) throw new Error('Missing MCP bearer token')
          return {
            content: [{
              type: 'text',
              text: await tool.execute(args, token, {
                requestId: String(extra.mcpReq.id),
                sessionId: extra.sessionId,
                clientFingerprint: crypto.createHash('sha256').update(token).digest('hex'),
              }),
            }],
          }
        })
      }
    },
    { serverInfo: MCP_SERVER_INFO, verboseLogs: false }
  )
}
