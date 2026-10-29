import { z } from "zod";
import type { SettingsSectionId } from "@/components/Modals/Settings/settingsNavigation";

export const settingsPages = {
  general: "Display name, profile picture, email and delete account",
  appearance: "Theme: Follow system, Light · Porcelain, Dark · Graphite, OLED black · AMOLED, Paper · Dia, Material",
  notifications: "Mentions, comments, assignments, task updates and due dates, each by email and push; master email notifications and push notifications on this device (manual-only)",
  calendar: "Week starts on, show weekends, Google Calendar connection, task sync and disconnect (manual-only)",
  inbox: "Archive and go to next task after sending a comment; display avatar in inbox (manual-only)",
  "task-page": "Collapse comments, play GIFs, suggest descriptions from titles, show task history, read receipts, scroll position, AI chat auto-open on new tickets, existing tickets and boards (manual-only)",
  "my-ai-usage": "Your personal AI usage",
  accounts: "Connected accounts",
  members: "Team name, seats, auto-join email domains, invitations, board member roles and removing team members",
  "team-agents": "Team agents",
  skills: "Team skills",
  billing: "Current plan, payment method, invoices and billing details",
  plans: "Plans and subscriptions",
  "ai-usage": "Team AI usage",
  "member-usage": "AI usage by team member",
  "ai-models": "Team AI models and providers",
  "ai-features": "Team AI features",
  "default-models": "Default AI models",
  apiKeys: "Bring your own AI provider keys",
  "board-general": "Board ticket prefix, board notifications, time tracking, show total task time, archive/restore/delete boards and per-column auto-assign (manual-only)",
  "board-planning": "Cycles, board target date, milestones, health updates (manual-only)",
  "board-staleness": "Staleness thresholds, stale reminders and auto-archive (manual-only)",
  "board-members": "People and their roles on the selected board",
  "board-agents": "Agents with access to the board",
  "board-ai": "Board custom AI instructions",
  "board-task-templates": "Task templates for this board, used by the task writer",
  "board-memory": "Board AI memory",
  "board-skills": "Board skills",
  "board-files": "Board files",
  "developer-access": "Developer access and tokens",
  slack: "Slack integration",
  webhooks: "Webhooks",
  mcp: "MCP connections and tokens",
  "management-keys": "Team management keys",
  cli: "CLI setup",
  api: "REST API reference",
  shortcuts: "Keyboard shortcuts",
  learn: "Learn Hypertask",
  feedback: "Send feedback",
  announcements: "Latest updates",
} as const satisfies Record<SettingsSectionId, string>;

export const settingsPageSchema = z.enum(Object.keys(settingsPages) as [keyof typeof settingsPages, ...(keyof typeof settingsPages)[]]);
export const settingsScopeSchema = z.object({
  section: settingsPageSchema,
  projectId: z.number().int().positive().optional(),
  theme: z.enum(["system", "porcelain", "graphite", "amoled", "dia", "rounded"]).optional(),
}).strict();
export type SettingsScope = z.infer<typeof settingsScopeSchema>;

export const settingChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("theme"), value: z.enum(["system", "porcelain", "graphite", "amoled", "dia", "rounded"]) }).strict(),
  z.object({
    kind: z.literal("notification"),
    category: z.enum(["mentions", "comments", "assignments", "moves", "dueDates"]),
    channel: z.enum(["email", "push"]),
    value: z.boolean(),
  }).strict(),
  z.object({ kind: z.literal("board-role"), targetUserId: z.number().int().positive(), value: z.enum(["Admin", "Member"]) }).strict(),
]);
export type SettingChange = z.infer<typeof settingChangeSchema>;
export type SettingValue = string | boolean;
export type SettingProposal = {
  id: string;
  userId: number;
  sessionId: string;
  scope: SettingsScope;
  change: SettingChange;
  label: string;
  before: SettingValue;
  after: SettingValue;
  status: "pending" | "applied" | "cancelled" | "undone";
};
export type SettingProposalCard = Pick<SettingProposal, "id" | "label" | "before" | "after" | "status"> & {
  path: string;
  accessChange: boolean;
};

export function settingsScopeFromPath(path: string | null | undefined, projectId?: number, theme?: SettingsScope["theme"]): SettingsScope | undefined {
  if (path !== "/settings" && !path?.startsWith("/settings/")) return undefined;
  const section = settingsPageSchema.safeParse((path ?? "").split("/")[2] || "general");
  if (!section.success) return undefined;
  return { section: section.data, ...(section.data.startsWith("board-") || section.data === "members" ? { projectId } : {}), ...(theme ? { theme } : {}) };
}

export function assertSettingPage(scope: SettingsScope, change: SettingChange) {
  const allowed = change.kind === "theme" ? scope.section === "appearance"
    : change.kind === "notification" ? scope.section === "notifications"
      : (scope.section === "board-members" || scope.section === "members") && !!scope.projectId;
  if (!allowed) throw new Error("Open the setting's page before asking for this change.");
}

export function settingProposalCard(proposal: SettingProposal): SettingProposalCard {
  return {
    id: proposal.id,
    label: proposal.label,
    before: proposal.before,
    after: proposal.after,
    status: proposal.status,
    path: `/settings/${proposal.scope.section}`,
    accessChange: proposal.change.kind === "board-role",
  };
}

export function extractSettingCards(content: string) {
  const ids = new Set<string>();
  const html = content.replace(/<a\s+href=["']\/settings\/ai-change\/([0-9a-f-]{36})["'][^>]*>[^<]*<\/a>/gi, (_match, id: string) => {
    ids.add(id);
    return "";
  });
  return { html, ids: [...ids] };
}
