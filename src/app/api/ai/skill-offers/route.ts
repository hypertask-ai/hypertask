import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { saveBoardMemoryRule } from "@/app/api/ai/_lib/boardMemory";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { browserMutationIsSameOrigin } from "@/lib/agentRuns/service";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7779_SKILL_OFFERS_FLAG } from "@/lib/flags/definitions/htpr-7779-skill-offers";
import type { SkillOfferCard, SkillOfferRecord } from "@/lib/ai/skillOffers/contract";
import { decideSkillOffer, loadSkillOffer } from "@/lib/ai/skillOffers/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const actionSchema = z
  .object({ id: idSchema, action: z.enum(["draft", "dismiss", "save"]) })
  .strict();

export function skillOfferCard(record: SkillOfferRecord): SkillOfferCard {
  return {
    id: record.id,
    kind: record.kind,
    rule: record.rule,
    occurrences: record.occurrences,
    sessionCount: record.sessionCount,
    quotes: record.quotes.slice(0, 2).map((quote) => quote.quote),
    draft: record.draft,
    status: record.status,
  };
}

async function offerUser(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session?.userId || session.agentId) {
    throw new Error("Sign in as yourself to review skill suggestions.");
  }
  if (!(await isFeatureEnabled(HTPR_7779_SKILL_OFFERS_FLAG, session.userId))) {
    throw new Error("Skill suggestions are not available for this account.");
  }
  return session.userId;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await offerUser(request);
    const id = idSchema.parse(request.nextUrl.searchParams.get("id"));
    const offer = await loadSkillOffer(userId, id);
    if (!offer) {
      return NextResponse.json({ error: "This suggestion expired." }, { status: 404 });
    }
    return NextResponse.json(
      { offer: skillOfferCard(offer) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load skill suggestion" },
      { status: 403 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!browserMutationIsSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  let userId: number;
  try {
    userId = await offerUser(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Skill suggestions are unavailable" },
      { status: 403 },
    );
  }

  const input = actionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "Invalid skill suggestion action" }, { status: 400 });
  }

  try {
    const offer = await loadSkillOffer(userId, input.data.id);
    if (!offer) {
      return NextResponse.json({ error: "This suggestion expired." }, { status: 404 });
    }
    if (input.data.action === "save") {
      if (offer.kind !== "memory") {
        return NextResponse.json({ error: "This suggestion is a skill, not a memory rule." }, { status: 400 });
      }
      await saveBoardMemoryRule({ userId, projectId: offer.projectId, rule: offer.rule });
      const saved = await decideSkillOffer({ userId, id: offer.id, decision: "saved" });
      return NextResponse.json({ offer: skillOfferCard(saved ?? offer) });
    }
    const updated = await decideSkillOffer({
      userId,
      id: offer.id,
      decision: input.data.action === "dismiss" ? "dismissed" : "drafted",
    });
    return NextResponse.json({ offer: skillOfferCard(updated ?? offer) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update skill suggestion" },
      { status: 409 },
    );
  }
}
