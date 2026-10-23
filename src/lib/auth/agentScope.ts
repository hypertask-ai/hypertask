import { AsyncLocalStorage } from "node:async_hooks";
import { HTPR_7146_AGENT_SCOPE_ENFORCE_FLAG } from "@/lib/flags/keys";
import { recordServerCapture } from "@/lib/telemetry/signupAnalytics";

type Scope = {
  route: string;
  action: "read" | "write";
  mode?: Promise<"WATCH" | "ENFORCE">;
  enforced?: boolean;
  actor?: { agentId: string; ownerUserId: number; projectIds: Set<number> };
  prepared?: Promise<void>;
};
const scopes = new AsyncLocalStorage<Scope>();
const misses = new Map<string, number>();
const HOUR_MS = 60 * 60 * 1000;

export function withAgentScopeRequest<T>(
  request: { url?: string; method?: string },
  run: () => T,
): T {
  if (scopes.getStore()) return run();
  const route = new URL(request.url || "/", "http://localhost").pathname;
  const action = !request.method || /^(GET|HEAD|OPTIONS)$/i.test(request.method) ? "read" : "write";
  return scopes.run({ route, action }, run);
}

export function agentScopeMode(ownerUserId: number): Promise<"WATCH" | "ENFORCE"> {
  const scope = scopes.getStore();
  const read = async () => {
    try {
      const { isFeatureEnabled } = await import("@/lib/flags");
      return await isFeatureEnabled(HTPR_7146_AGENT_SCOPE_ENFORCE_FLAG, ownerUserId) ? "ENFORCE" : "WATCH";
    } catch {
      console.warn("[agent-board-scope] flag read failed; using WATCH");
      return "WATCH";
    }
  };
  return scope ? (scope.mode ??= read()) : read();
}

export async function prepareAgentScope(ownerUserId: number, agentId?: string | null): Promise<void> {
  const scope = scopes.getStore();
  if (!scope || !agentId) return;
  await (scope.prepared ??= (async () => {
    scope.enforced = await agentScopeMode(ownerUserId) === "ENFORCE";
    if (scope.enforced) return;
    const { default: prisma } = await import("@/lib/prisma");
    const members = await prisma.member.findMany({
      where: { agentId, status: "Accepted", agent: { userId: ownerUserId, revokedAt: null } },
      select: { projectId: true },
    });
    scope.actor = { agentId, ownerUserId, projectIds: new Set(members.map(member => member.projectId)) };
  })());
}

export function agentScopeEnforced(): boolean {
  const scope = scopes.getStore();
  if (!scope) return true;
  if (scope.enforced === undefined) throw new Error("Agent scope must be prepared after authentication");
  return scope.enforced;
}

export function recordAgentBoardScopeMiss(projectId: number | null | undefined, action?: "read" | "write"): void {
  if (typeof projectId !== "number" || !Number.isSafeInteger(projectId) || projectId <= 0) return;
  const scope = scopes.getStore();
  const actor = scope?.actor;
  if (!actor || actor.projectIds.has(projectId)) return;
  const now = Date.now();
  const operation = action ?? scope.action;
  const key = `${actor.agentId}:${projectId}:${operation}`;
  if ((misses.get(key) ?? 0) > now) return;
  for (const [entry, expiresAt] of misses) {
    if (expiresAt > now) break;
    misses.delete(entry);
  }
  misses.set(key, now + HOUR_MS);
  recordServerCapture({
    distinctId: String(actor.ownerUserId),
    event: "agent_board_scope_miss",
    properties: {
      agentId: actor.agentId,
      ownerUserId: actor.ownerUserId,
      projectId,
      route: scope.route,
      action: operation,
      zeroBoard: actor.projectIds.size === 0,
    },
  }, { onError: () => console.warn("[agent-board-scope] miss capture failed") });
}
