import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7328_ROUNDED_THEME_FLAG } from "@/lib/flags/keys";
import { themeOptions } from "@/lib/themePreferences";
import setMemberRole from "@/utils/controllers/projects/setMemberRole";
import { notificationCategories, notificationCellValue, updateNotificationMatrix } from "@/utils/controllers/notifications/updateNotificationMatrix";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { assertSettingPage, type SettingChange, type SettingProposal, type SettingsScope } from "./catalog";

export async function readSettingsPage(userId: number, scope: SettingsScope) {
  if (scope.section === "appearance") {
    const rounded = await isFeatureEnabled(HTPR_7328_ROUNDED_THEME_FLAG, userId);
    return { theme: scope.theme ?? "system", options: themeOptions.filter((option) => rounded || option.value !== "rounded") };
  }
  if (scope.section === "notifications") {
    const settings = await prisma.userSetting.findUnique({
      where: { userId },
      select: { notificationMatrix: true, notificationPreference: true, notification: true },
    });
    if (!settings) throw new Error("User settings not found");
    return {
      emailEnabled: settings.notification,
      matrix: Object.fromEntries(notificationCategories.map((category) => [category, {
        email: notificationCellValue(settings.notificationMatrix, settings.notificationPreference ?? "all", category, "email"),
        push: notificationCellValue(settings.notificationMatrix, settings.notificationPreference ?? "all", category, "push"),
      }])),
    };
  }
  if (scope.section === "members" || scope.section === "board-members") {
    if (!scope.projectId) throw new Error("Select a board first.");
    const project = await prisma.project.findFirst({
      where: {
        id: scope.projectId,
        status: { not: "Deleted" },
        OR: [{ ownerId: userId }, { members: { some: { userId, agentId: null, status: "Accepted" } } }],
      },
      select: {
        title: true,
        ownerId: true,
        members: {
          where: { agentId: null, status: "Accepted" },
          select: { userId: true, role: true, user: { select: { displayName: true, email: true } } },
        },
      },
    });
    if (!project) throw new Error("Board not found or access denied.");
    return { board: project.title, ownerId: project.ownerId, canChangeRoles: project.ownerId === userId, members: project.members };
  }
  return { manualOnly: true };
}

export async function readSettingChange(userId: number, scope: SettingsScope, change: SettingChange) {
  assertSettingPage(scope, change);
  if (change.kind === "theme") {
    if (change.value === "rounded" && !(await isFeatureEnabled(HTPR_7328_ROUNDED_THEME_FLAG, userId))) {
      throw new Error("Material theme is not available for your account.");
    }
    return { label: "Theme", value: scope.theme ?? "system" };
  }
  if (change.kind === "notification") {
    const settings = await prisma.userSetting.findUnique({
      where: { userId },
      select: { notificationMatrix: true, notificationPreference: true },
    });
    if (!settings) throw new Error("User settings not found");
    return {
      label: `${change.channel === "email" ? "Email" : "Push"} notifications for ${change.category === "moves" ? "task updates" : change.category === "dueDates" ? "due dates" : change.category}`,
      value: notificationCellValue(settings.notificationMatrix, settings.notificationPreference ?? "all", change.category, change.channel),
    };
  }
  const page = await readSettingsPage(userId, scope);
  if (!("canChangeRoles" in page) || !page.canChangeRoles) throw new Error("Only the board owner can change member roles. Open Board settings, Members.");
  if (change.targetUserId === userId || change.targetUserId === page.ownerId) throw new Error("You cannot change your own role or the board owner's role.");
  const member = page.members.find((entry) => entry.userId === change.targetUserId);
  if (!member) throw new Error("Accepted human board member not found.");
  return { label: `${member.user.displayName || member.user.email} — role on ${page.board || `board ${scope.projectId}`}`, value: member.role };
}

export async function applySettingChange(proposal: SettingProposal, undo: boolean, currentTheme?: SettingsScope["theme"]): Promise<{ theme?: SettingsScope["theme"] }> {
  const scope = { ...proposal.scope, ...(currentTheme ? { theme: currentTheme } : {}) };
  const current = await readSettingChange(proposal.userId, scope, proposal.change);
  const expected = undo ? proposal.after : proposal.before;
  const next = undo ? proposal.before : proposal.after;
  if (current.value !== expected) throw new Error("This setting changed since the preview. Ask for a fresh proposal.");
  const change = proposal.change;
  if (change.kind === "theme") {
    if (next === "rounded" && !(await isFeatureEnabled(HTPR_7328_ROUNDED_THEME_FLAG, proposal.userId))) throw new Error("Material theme is not available for your account.");
    return { theme: next as SettingsScope["theme"] };
  }
  if (change.kind === "notification") {
    await updateNotificationMatrix(proposal.userId, { category: change.category, channel: change.channel, expected: expected as boolean, value: next as boolean });
    return {};
  }
  const result = await setMemberRole(proposal.userId, scope.projectId!, change.targetUserId, next as "Admin" | "Member", expected as "Admin" | "Member");
  if (result.status !== 200) throw new Error((result.json as { message?: string }).message ?? "Could not change member role");
  void broadcastBoardChange(scope.projectId!, { originUserId: proposal.userId });
  return {};
}
