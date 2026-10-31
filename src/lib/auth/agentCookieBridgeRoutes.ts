export const AGENT_COOKIE_BRIDGE_ROUTES = [
  ['POST', '/api/tasks/createGlobally'],
  ['PUT', '/api/tasks/single'],
  ['PUT', '/api/tasks/moveTask'],
  ['POST', '/api/tasks/(un)archive'],
  ['POST', '/api/queues/tasks/taskDeleteReminder'],
  ['POST', '/api/tasks/setDueDate'],
  ['POST', '/api/priority/setPriority'],
  ['POST', '/api/estimate/setEstimate'],
] as const

export function isAgentCookieBridgeRequestAllowed(
  session: { agentId?: string } | null | undefined,
  method: string,
  pathname: string,
): boolean {
  return !session?.agentId || AGENT_COOKIE_BRIDGE_ROUTES.some(
    ([bridgeMethod, bridgePath]) => method === bridgeMethod && pathname === bridgePath,
  )
}
