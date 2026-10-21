
export type MentionAgentItem = { type?: unknown; id?: unknown };

export function extractMentionedAgentIds(contextList: unknown): string[] {
  if (!Array.isArray(contextList)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of contextList) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as MentionAgentItem;
    if (record.type !== "agent" || typeof record.id !== "string") continue;
    const id = record.id.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export type AgentMentionDecision =
  | { route: true; agentId: string }
  | { route: false; reason: string };

export function decideAgentMentionRouting(input: {
  routingEnabled: boolean;
  mentionedAgentIds: string[];
  hasAttachments: boolean;
  hasBoardContext: boolean;
  hasActingAgent: boolean;
}): AgentMentionDecision {
  if (!input.routingEnabled) return { route: false, reason: "flag-off" };
  if (input.hasActingAgent) return { route: false, reason: "native-agent-session" };
  if (input.hasAttachments) return { route: false, reason: "attachments" };
  if (!input.hasBoardContext) return { route: false, reason: "no-board-context" };
  if (input.mentionedAgentIds.length === 0)
    return { route: false, reason: "no-mention" };
  if (input.mentionedAgentIds.length > 1)
    return { route: false, reason: "multiple-mentions" };
  return { route: true, agentId: input.mentionedAgentIds[0] };
}
