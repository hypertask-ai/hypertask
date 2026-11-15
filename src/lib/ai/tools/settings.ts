import { tool } from "ai";
import { z } from "zod";
import { readSettingsPage } from "@/lib/ai/settings/actions";
import { assertSettingsEnabled, createSettingProposal } from "@/lib/ai/settings/proposals";
import { settingChangeSchema, settingsPages, settingsPageSchema, teamAreaPages } from "@/lib/ai/settings/catalog";
import { withToolErrors } from "./execution";
import type { ToolContext } from "./context";

export function createSettingsTool(context: ToolContext) {
  let proposalIssued = false;
  return {
    hypertask_settings: tool({
      description: "Help with the currently open Settings page, using only the signed-in person's rights. Read first for current values and exact ids. Propose ONE change: theme, notification category or channel, email notification switch, board member role, column visibility, team AI provider, existing own-key switch, skill switch, webhook switch, or management-key switch. This never applies it. The app shows From and To, then Apply, Cancel, and Undo. Only the board owner can change roles. Only the team owner can change providers, keys, webhooks, and management keys. A person can change only their own skills and email switch. Never claim success before Apply. Billing, deletion, invitations, and new secrets stay manual. Never type a key or token into chat, and never use other tools to bypass the confirmation card. Settings outside the open page require opening that page first.",
      inputSchema: z.object({
        action: z.enum(["read", "propose", "open"]),
        change: settingChangeSchema.optional(),
        section: settingsPageSchema.optional(),
      }).strict(),
      execute: withToolErrors(async (input) => {
        await assertSettingsEnabled(context.user.id, context.actingAgentId);
        const scope = context.body.settings_context;
        if (!scope) return { success: false, error: "Open Settings first." };
        context.sendStatus("hypertask_settings");
        if (input.action === "open") {
          if (!input.section) return { success: false, error: "Choose a settings section from the catalog." };
          const section: keyof typeof settingsPages = input.section;
          const path = `/settings/${section}`;
          context.send("settings", { path });
          return { success: true, path, settings: settingsPages[section], message: "Opened the setting's page. No setting was changed. The next message uses the newly open page." };
        }
        if (input.action === "read") {
          return { success: true, section: scope.section, catalog: settingsPages, current: await readSettingsPage(context.user.id, scope) };
        }
        if (proposalIssued) return { success: false, error: "Review the existing card first. Only one proposal is shown per reply." };
        if (!input.change || !context.body.session_id) return { success: false, error: "A change and a personal chat session are required." };
        proposalIssued = true;
        try {
          const proposal = await createSettingProposal(context.user.id, context.body.session_id, scope, input.change);
          return { success: true, proposal, message: "Nothing changed yet. Ask the person to review the app's confirmation card and press Apply or Cancel." };
        } catch (error) {
          const section = input.change.kind === "theme" ? "appearance" : input.change.kind === "notification" ? "notifications" : input.change.kind === "team-area" ? teamAreaPages[input.change.area] : "board-members";
          context.send("settings", { path: `/settings/${section}` });
          return { success: false, error: error instanceof Error ? error.message : "Could not propose setting change", path: `/settings/${section}` };
        }
      }),
    }),
  };
}
