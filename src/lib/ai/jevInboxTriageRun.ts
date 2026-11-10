import { generateText } from "ai";

import prisma from "@/lib/prisma";

import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import {
  gatewayProviderOptionsForModel,
  resolveGatewayModel,
  type AiGatewayTags,
} from "@/app/api/ai/_lib/modelProvider";
import {
  JEV_TRIAGE_BATCH_SIZE,
  JEV_TRIAGE_CALL_TIMEOUT_MS,
  JEV_TRIAGE_CONCURRENCY,
  JEV_TRIAGE_MAX_ITEMS,
  JEV_TRIAGE_MODEL_SLUG,
  buildJevTriagePrompt,
  jevTriageBatches,
  parseJevTriageBatch,
  selectJevNoiseIds,
  type JevTriageItem,
} from "@/lib/ai/jevInboxTriage";

export type JevTriageSkipped = "no_team" | "customer_funding" | "no_funding" | null;

export type JevTriageResult = {
  noiseIds: string[];
  checked: number;
  skipped: JevTriageSkipped;
};

const withDeadline = <T,>(work: Promise<T>, fallback: T): Promise<T> => {
  const deadline = new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), JEV_TRIAGE_CALL_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([work, deadline]);
};

const askJev = async (
  prompt: string,
  apiKey: string,
  tags: AiGatewayTags
): Promise<string | null> => {
  const model = resolveGatewayModel(JEV_TRIAGE_MODEL_SLUG, apiKey);
  const reply = generateText({
    model,
    prompt,
    maxOutputTokens: 300,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(JEV_TRIAGE_CALL_TIMEOUT_MS),
    providerOptions: gatewayProviderOptionsForModel(model, "jev-inbox", tags),
  }).then(
    (result) => result.text,
    () => null
  );
  return withDeadline(reply, null);
};

const runWithConcurrency = async <T,>(
  batches: T[],
  worker: (batch: T) => Promise<void>
) => {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(JEV_TRIAGE_CONCURRENCY, batches.length) },
    async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor];
        cursor += 1;
        await worker(batch);
      }
    }
  );
  await Promise.all(workers);
};

export async function jevInboxTriage(args: {
  items: JevTriageItem[];
  teamId: string | null;
  userId: number;
}): Promise<JevTriageResult> {
  const items = args.items.slice(0, JEV_TRIAGE_MAX_ITEMS);
  if (!args.teamId) return { noiseIds: [], checked: 0, skipped: "no_team" };
  if (items.length === 0) return { noiseIds: [], checked: 0, skipped: null };

  let funding: Awaited<ReturnType<typeof getTeamGatewayFunding>>;
  try {
    funding = await getTeamGatewayFunding({ trustedTeamId: args.teamId });
  } catch (error) {
    console.warn("[ai/inbox-triage] Jev funding skipped", error);
    return { noiseIds: [], checked: 0, skipped: "no_funding" };
  }
  if (!funding?.apiKey) return { noiseIds: [], checked: 0, skipped: "no_funding" };
  if (funding.source === "customer") {
    return { noiseIds: [], checked: 0, skipped: "customer_funding" };
  }

  const tags: AiGatewayTags = { teamId: args.teamId, userId: args.userId };
  const batches = jevTriageBatches(items, JEV_TRIAGE_BATCH_SIZE);
  const noiseIds = new Set<string>();

  try {
    await runWithConcurrency(batches, async (batch) => {
      const text = await askJev(buildJevTriagePrompt(batch), funding.apiKey, tags);
      for (const id of selectJevNoiseIds(parseJevTriageBatch(text, batch))) {
        noiseIds.add(id);
      }
    });
  } catch (error) {
    console.warn("[ai/inbox-triage] Jev triage skipped", error);
    return { noiseIds: [], checked: 0, skipped: "no_funding" };
  }

  return {
    noiseIds: Array.from(noiseIds),
    checked: items.length,
    skipped: null,
  };
}

export async function loadInboxTriageTeamId(userId: number): Promise<string | null> {
  const team = await prisma.team.findFirst({
    where: { googleAccount: { userId } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return team?.id ?? null;
}
