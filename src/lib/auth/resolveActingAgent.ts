export type ActingAgentResolution =
  | { ok: true; agentId: string | null }
  | { ok: false; status: 400 | 403; message: string }

export function resolveActingAgent(input: {
  sessionAgentId?: string | null
  bodyAgentId?: unknown
}): ActingAgentResolution {
  const sessionAgentId =
    typeof input.sessionAgentId === 'string' && input.sessionAgentId.length > 0
      ? input.sessionAgentId
      : null

  if (input.bodyAgentId === undefined || input.bodyAgentId === null) {
    return { ok: true, agentId: sessionAgentId }
  }

  if (typeof input.bodyAgentId !== 'string' || input.bodyAgentId.length === 0) {
    return { ok: false, status: 400, message: 'Invalid agent id' }
  }

  const bodyAgentId = input.bodyAgentId
  if (!sessionAgentId) {
    return {
      ok: false,
      status: 403,
      message: 'Agent id must match an authenticated agent session claim',
    }
  }
  if (bodyAgentId !== sessionAgentId) {
    return {
      ok: false,
      status: 403,
      message: 'Agent id does not match authenticated session',
    }
  }
  return { ok: true, agentId: sessionAgentId }
}
