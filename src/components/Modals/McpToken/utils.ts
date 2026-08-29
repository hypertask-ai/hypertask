import type { Client, ConnectionMethod } from "./types"

export const MCP_SERVER_URL = process.env.NEXT_PUBLIC_MCP_SERVER_URL || "https://mcp.hypertask.ai/mcp"
export const MCP_DOCS_URL = "https://docs.hypertask.ai/mcp"

export type IntegrationId =
  | "claude"
  | "claude-code"
  | "codex"
  | "cursor"
  | "vscode"
  | "chatgpt"
  | "lovable"

export interface McpIntegration {
  id: IntegrationId
  label: string
  icon: string
  command: string
  hint: string
  bearerHint: string
}

export const MCP_INTEGRATIONS: McpIntegration[] = [
  {
    id: "claude",
    label: "Claude Desktop/Web",
    icon: "A",
    command: MCP_SERVER_URL,
    hint: "In Claude, go to Settings → Connectors → Add custom connector and paste this URL. Click Connect and approve — no token needed.",
    bearerHint: "Paste into MCP settings and restart your client.",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    icon: "A",
    command: `claude mcp add --transport http hypertask-mcp ${MCP_SERVER_URL}`,
    hint: "Run this command in your terminal, then use /mcp in Claude Code to authenticate.",
    bearerHint: "Paste into MCP settings and restart your client.",
  },
  {
    id: "codex",
    label: "Codex",
    icon: "O",
    command: `codex mcp add hypertask --url ${MCP_SERVER_URL}`,
    hint: "Run this in your terminal, then run codex mcp login hypertask to authenticate.",
    bearerHint: "Export your token as an env var, then register the server against it.",
  },
  {
    id: "cursor",
    label: "Cursor",
    icon: "C",
    command: `{
  "mcpServers": {
    "hypertask-mcp": {
      "url": "${MCP_SERVER_URL}"
    }
  }
}`,
    hint: "Add to Cursor MCP settings. Then run /mcp in Cursor to authenticate.",
    bearerHint: "Paste into MCP settings and restart your client.",
  },
  {
    id: "vscode",
    label: "VS Code",
    icon: "V",
    command: `{
  "servers": {
    "hypertask-mcp": {
      "type": "http",
      "url": "${MCP_SERVER_URL}"
    }
  }
}`,
    hint: "Run MCP: Open User Configuration (Ctrl+Shift+P) or add to .vscode/mcp.json. Paste the config, then restart VS Code. Requires VS Code 1.99+.",
    bearerHint: "Use the bearer token config below. VS Code will prompt for the token on first connect.",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    icon: "G",
    command: MCP_SERVER_URL,
    hint: "Workspace admins: Settings → Apps & Connectors → Create. Add this MCP server URL. Requires ChatGPT Business, Enterprise, or Edu plan. Enable Developer mode in Permissions first.",
    bearerHint: "When creating the app, choose Bearer token auth and paste your token.",
  },
  {
    id: "lovable",
    label: "Lovable",
    icon: "♥",
    command: MCP_SERVER_URL,
    hint: "Go to Settings → Connectors → Personal connectors → New MCP server. Enter the URL above. Choose Bearer token auth and paste your token. Requires a paid Lovable plan.",
    bearerHint: "Paste your token when adding the server. Lovable will store it securely.",
  },
]

export interface McpTool {
  name: string
  description: string
  color: "blue" | "purple" | "green" | "yellow"
}

export const MCP_TOOLS: McpTool[] = [
  { name: "Create Task", description: "Title, description, priority, estimate, section", color: "blue" },
  { name: "Update Task", description: "Title, priority, labels, status, followers", color: "purple" },
  { name: "List Tasks", description: "15+ filters, sorting, pagination", color: "blue" },
  { name: "Search Tasks", description: "By name, description, or ticket number", color: "green" },
  { name: "Add Comment", description: "With @mentions and notifications", color: "green" },
  { name: "Manage Sections", description: "List, create, update, delete columns", color: "yellow" },
  { name: "Move Task", description: "Move task to different board or section", color: "blue" },
  { name: "Assign User", description: "Assign or unassign users to tasks", color: "purple" },
  { name: "List Project Members", description: "Resolve @mentions and assign users", color: "green" },
  { name: "Get Inbox", description: "List inbox items and activity", color: "blue" },
  { name: "Archive Inbox", description: "Archive inbox items", color: "yellow" },
  { name: "List Projects", description: "List boards and projects", color: "blue" },
  { name: "List Sections", description: "List columns for a project", color: "green" },
  { name: "User Context", description: "Get current user and accessible projects", color: "purple" },
]

export function getConfigForClient(
  client: Client,
  method: ConnectionMethod,
  token: string | null
): string {
  if (client === "claude" && method === "dynamic") {
    return `claude mcp add --transport http hypertask-mcp ${MCP_SERVER_URL}`
  }
  if (method === "dynamic") {
    return `{
  "mcpServers": {
    "hypertask-mcp": {
      "url": "${MCP_SERVER_URL}"
    }
  }
}`
  }
  if (!token || token === "***") {
    return "Please generate a token first"
  }
  return `{
  "mcpServers": {
    "hypertask-mcp": {
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`
}

export function getConfigForIntegration(
  integrationId: IntegrationId,
  useBearer: boolean,
  token: string | null
): string {
  const integration = MCP_INTEGRATIONS.find((i) => i.id === integrationId)
  if (!integration) return "Please generate a token first"
  if (useBearer) {
    if (!token || token === "***") return "Please generate a token first"
    if (integrationId === "vscode") {
      return `{
  "servers": {
    "hypertask-mcp": {
      "type": "http",
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`
    }
    if (integrationId === "chatgpt" || integrationId === "lovable") {
      return token
    }
    if (integrationId === "codex") {
      return `export HYPERTASK_TOKEN="${token}"\ncodex mcp add hypertask --url ${MCP_SERVER_URL} --bearer-token-env-var HYPERTASK_TOKEN`
    }
    return `{
  "mcpServers": {
    "hypertask-mcp": {
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`
  }
  return integration.command
}
