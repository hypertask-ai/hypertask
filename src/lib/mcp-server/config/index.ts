export interface McpServerConfig {
  apiUrl: string
  requestTimeout: number
  createBoardRequestTimeoutMs: number
  attachmentRequestTimeoutMs: number
  limits: {
    ticketNumberMaxLength: number
    commentTextMaxLength: number
    searchQueryMaxLength: number
    searchLimitDefault: number
    searchLimitMax: number
  }
}

function envNumber(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

let config: McpServerConfig | undefined

export function getConfig(): McpServerConfig {
  if (!config) {
    config = {
      apiUrl: (process.env.MCP_SELF_API_URL ?? 'https://app.hypertask.ai/api').replace(/\/$/, ''),
      requestTimeout: envNumber('REQUEST_TIMEOUT', 30000),
      createBoardRequestTimeoutMs: envNumber('CREATE_BOARD_REQUEST_TIMEOUT_MS', 120000),
      // Longer than the route's absolute 630s batch deadline, shorter than MCP's 800s cap.
      attachmentRequestTimeoutMs: envNumber('ATTACHMENT_REQUEST_TIMEOUT_MS', 660000),
      limits: {
        ticketNumberMaxLength: envNumber('LIMIT_TICKET_NUMBER_MAX', 50),
        commentTextMaxLength: envNumber('LIMIT_COMMENT_TEXT_MAX', 5000),
        searchQueryMaxLength: envNumber('LIMIT_SEARCH_QUERY_MAX', 200),
        searchLimitDefault: envNumber('LIMIT_SEARCH_DEFAULT', 10),
        searchLimitMax: envNumber('LIMIT_SEARCH_MAX', 50),
      },
    }
  }

  return config
}
