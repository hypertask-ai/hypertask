import { featureFlagsForUser } from "@/lib/flags";
import type { FirstScreenFlags } from "./contract";

export async function getFirstScreenFlagSeed(
  accountId: number,
  keys: readonly string[],
  evaluatedAt: string,
): Promise<FirstScreenFlags> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !Number.isFinite(Date.parse(evaluatedAt))) {
    throw new Error("Invalid first-screen flag scope");
  }
  const flags = await featureFlagsForUser(accountId);
  return { accountId, evaluatedAt, values: Object.fromEntries(keys.map((key) => [key, flags[key] === true])) };
}

export async function getFirstVisitFlagSeed(accountId: number): Promise<FirstScreenFlags> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error("Invalid first-screen flag scope");
  }
  return { accountId, evaluatedAt: new Date().toISOString(), values: await featureFlagsForUser(accountId) };
}
