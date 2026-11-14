import { generateText } from "ai";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { gatewayProviderOptionsForModel, resolveGatewayModel, type AiGatewayTags } from "@/app/api/ai/_lib/modelProvider";
import {
  JEV_DUPLICATE_CALL_TIMEOUT_MS,
  buildJevDuplicatePrompt,
  formatDuplicateCheckHint,
  parseJevVerdict,
  selectJevDuplicateMatch,
  type JevDuplicateCandidate,
  type JevDuplicateDraft,
} from "@/lib/ai/jevDuplicateCheck";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

export const DUPLICATE_DECISION_MODEL_SLUG = "anthropic/claude-haiku-5.5";

function withDeadline<T>(work: Promise<T>, fallback: T): Promise<T> {
  const deadline = new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), JEV_DUPLICATE_CALL_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([work, deadline]);
}

async function askJev(
  prompt: string,
  apiKey: string,
  tags: AiGatewayTags
): Promise<string | null> {
  const model = resolveGatewayModel(DUPLICATE_DECISION_MODEL_SLUG, apiKey);
  const reply = generateText({
    model,
    prompt,
    maxOutputTokens: 16,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(JEV_DUPLICATE_CALL_TIMEOUT_MS),
    providerOptions: gatewayProviderOptionsForModel(model, "jev-duplicate", tags),
  }).then((result) => result.text, () => null);
  return withDeadline(reply, null);
}

export async function jevDuplicateHint(args: {
  draft: JevDuplicateDraft;
  candidates: JevDuplicateCandidate[];
  projectId: number;
  userId: number;
  teamId: string | null;
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}): Promise<string> {
  if (args.candidates.length === 0 || !args.teamId) return "";
  try {
    const funding = await getTeamGatewayFunding({
      trustedTeamId: args.teamId,
      projectId: args.projectId,
      userId: args.userId,
      agentId: args.agentId,
      teamScope: args.teamScope,
    });
    if (!funding?.apiKey) return "";
    if (funding.source === "customer" && !isInternalCompTeam(args.teamId)) return "";
    const tags: AiGatewayTags = {
      teamId: args.teamId, projectId: args.projectId, userId: args.userId, agentId: args.agentId,
    };
    const verdicts = await Promise.all(
      args.candidates.map(async (candidate) => ({
        candidate,
        verdict: parseJevVerdict(
          await askJev(buildJevDuplicatePrompt(args.draft, candidate), funding.apiKey, tags)
        ),
      }))
    );
    return formatDuplicateCheckHint(selectJevDuplicateMatch(verdicts));
  } catch (error) {
    console.warn("[ai/task-writer] jev duplicate check skipped", error);
    return "";
  }
}
