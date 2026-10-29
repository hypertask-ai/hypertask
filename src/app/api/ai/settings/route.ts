import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { browserMutationIsSameOrigin } from "@/lib/agentRuns/service";
import { normalizeThemePreference } from "@/lib/themePreferences";
import { actOnSettingProposal, loadSettingProposal } from "@/lib/ai/settings/proposals";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { settingProposalCard, settingsScopeSchema, type SettingsScope } from "@/lib/ai/settings/catalog";

export const runtime = "nodejs";
const idSchema = z.string().uuid();
const actionSchema = z.object({ id: idSchema, action: z.enum(["apply", "cancel", "undo"]), scope: settingsScopeSchema.optional() }).strict();

async function settingsUser(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session || session.agentId) throw new Error("Sign in as yourself to review settings changes.");
  // Server-side gate: the flag is checked at the entry point as well as inside the proposal store.
  if (!(await isFeatureEnabled(HTPR_7622_AI_SETTINGS_FLAG, session.userId))) throw new Error("AI settings changes are not available for this account.");
  return session.userId;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await settingsUser(request);
    const id = idSchema.parse(request.nextUrl.searchParams.get("id"));
    const proposal = await loadSettingProposal(userId, id);
    return NextResponse.json({ proposal: settingProposalCard(proposal) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load setting change" }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  if (!browserMutationIsSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  let userId: number;
  try {
    userId = await settingsUser(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI settings are unavailable" }, { status: 403 });
  }
  try {
    const input = actionSchema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: "Invalid setting action" }, { status: 400 });
    const scope: SettingsScope | undefined = input.data.scope ? { ...input.data.scope, theme: normalizeThemePreference(request.cookies.get("theme")?.value, true) ?? "system" } : undefined;
    const result = await actOnSettingProposal(userId, input.data.id, input.data.action, scope);
    const response = NextResponse.json(result);
    if ("theme" in result && result.theme) response.cookies.set("theme", result.theme, { maxAge: 600 * 60 * 24 * 7, path: "/", sameSite: "lax" });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not change setting" }, { status: 409 });
  }
}
