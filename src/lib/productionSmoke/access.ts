export type CoreSmokePrincipal = {
  user: { id: number };
  agentId: string | null;
};

const PRODUCTION_ORIGIN = "https://app.hypertask.ai";

export const isProductionCoreSmokeRequest = (requestUrl: string) => {
  try {
    return new URL(requestUrl).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
};

export type CoreSmokeAccessDecision =
  | {
      ok: false;
      status: 401 | 403 | 409;
      error: string;
    }
  | {
      ok: true;
      principal: CoreSmokePrincipal & { agentId: null };
    };

export function decideCoreSmokeAccess(
  principal: CoreSmokePrincipal | null,
  fixtureMatches: boolean,
): CoreSmokeAccessDecision {
  if (!principal) return { ok: false, status: 401, error: "Unauthorized" };
  if (principal.agentId !== null) {
    return {
      ok: false,
      status: 403,
      error: "The core smoke check requires a user token",
    };
  }
  if (fixtureMatches === false) {
    return {
      ok: false,
      status: 409,
      error: "Fixture does not match the dedicated core-smoke board",
    };
  }
  return { ok: true, principal: { ...principal, agentId: null } };
}
