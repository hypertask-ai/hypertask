import { tool } from "ai";
import { z } from "zod";
import { readSettingsPage } from "@/lib/ai/settings/actions";
import { assertSettingsEnabled, createSettingProposal } from "@/lib/ai/settings/proposals";
import { settingChangeSchema, settingsPages, settingsPageSchema } from "@/lib/ai/settings/catalog";
import { withToolErrors } from "./execution";
import type { ToolContext } from "./context";

export function createSettingsTool(context: ToolContext) {
  let proposalIssued = false;
  return {
    hypertask_settings: tool({
      description: "Help with the currently open Settings page, using only the signed-in person's rights. Read first for current values and exact member IDs. Propose ONE theme, notification category/channel, or board member role change; this never applies it. The app shows From/To, Apply and Cancel, then Undo. Only the board owner can change roles. Never claim success before Apply. For any other setting, read the page catalog, explain where it lives, and use open to take the person there for the manual action. Settings outside the open page require opening that page first. Billing, keys, deletion, invitations and other settings are manual-only, never simulate them or use other tools to bypass confirmation.",
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
          const path = `/settings/${input.section}`;
          context.send("settings", { path });
          return { success: true, path, settings: settingsPages[input.section], message: "Opened the setting's page. No setting was changed. The next message uses the newly open page." };
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
          const section = input.change.kind === "theme" ? "appearance" : input.change.kind === "notification" ? "notifications" : "board-members";
          context.send("settings", { path: `/settings/${section}` });
          return { success: false, error: error instanceof Error ? error.message : "Could not propose setting change", path: `/settings/${section}` };
        }
      }),
    }),
  };
}
