export const AGENT_ROOM_BOT_TURN_LIMIT = 3;
export const AGENT_ROOM_DAILY_TURN_BUDGET = 50;

export type RoomAgentIdentity = {
  id: string;
  displayName: string;
};

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionedRoomAgents(
  text: string,
  agents: readonly RoomAgentIdentity[],
  authorAgentId: string | null,
): string[] {
  return agents
    .filter((agent) => agent.id !== authorAgentId)
    .filter((agent) =>
      new RegExp(`(^|\\W)${escapedRegExp(agent.displayName)}(?=$|\\W)`, "i").test(
        text,
      ),
    )
    .map((agent) => agent.id);
}

export function nextRoomBotDepth(parentDepth: number): number | null {
  return parentDepth >= AGENT_ROOM_BOT_TURN_LIMIT
    ? null
    : parentDepth + 1;
}

export function roomBudgetWindow(now = new Date()): {
  start: Date;
  end: Date;
} {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
