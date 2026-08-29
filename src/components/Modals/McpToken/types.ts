export type Client = "claude" | "cursor"
export type ConnectionMethod = "dynamic" | "bearer"

export interface Connection {
  client_id: string
  client_name: string | null
  createdAt: Date
  lastAuthorized: Date
  enabled: boolean | null
  connected_via_agent?: boolean
  agent_display_name?: string | null
}

export interface McpTokenModalProps {
  currentUser: { id: number; email?: string; displayName?: string | null }
  closeHandler: () => void
}

export interface TokenStatus {
  token: string | null
  expiresAt: string | null
  isLoading: boolean
  isGenerating: boolean
}
