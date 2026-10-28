import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";

const contexts = new AsyncLocalStorage<{ fence: Prisma.ProjectWhereInput | null }>();

export function withCrossTeamContext<T>(run: () => T): T {
  return contexts.getStore() ? run() : contexts.run({ fence: null }, run);
}

export function setCrossTeamRequestFence(fence: Prisma.ProjectWhereInput | null): void {
  const context = contexts.getStore();
  if (context) context.fence = fence;
}

export function crossTeamRequestFence(): Prisma.ProjectWhereInput | null {
  return contexts.getStore()?.fence ?? null;
}
