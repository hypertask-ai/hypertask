import prisma from "@/lib/prisma";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { escapeHtml } from "@/utils/htmlEscape";

import type { parsePostHogIssueAlert } from "@/lib/telemetry/posthogErrorAlert";

type PostHogDispatchFallbackAlert = NonNullable<ReturnType<typeof parsePostHogIssueAlert>>;

export async function recordPostHogDispatchFallback(
  alert: PostHogDispatchFallbackAlert,
  githubStatus: 403 | 429,
) {
  const projectId = 4060;
  const issueUrl = `https://eu.posthog.com/project/236160/error_tracking/${alert.issue_id}`;
  const marker = `posthog-dispatch-fallback:issue:${alert.issue_id}:${alert.event_id}`;
  const existing = await prisma.task.findFirst({
    where: { projectId, description_: { is: { content: { contains: `<p>${marker}</p>` } } } },
    select: { id: true },
  });
  if (existing) return existing;
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: { where: { deleted: false, visibility: true, section_title: "Backlog" }, select: { id: true, section_title: true }, take: 1 },
      labels: { where: { value: "Infra" }, select: { id: true }, take: 1 },
    },
  });
  const section = project?.section[0];
  if (!project?.uniqueIdentifier || !section || !project.labels[0]) throw new Error("PostHog fallback board is unavailable");
  const description = `<p><strong>A production error needs review.</strong> GitHub refused alert delivery with HTTP ${githubStatus}. The error remains visible here without GitHub.</p><p><a href="${escapeHtml(issueUrl)}">Review the error in PostHog</a></p><p>Seen: ${escapeHtml(alert.timestamp)}.</p><p>${marker}</p>`;
  const { task } = await createProvisionedTaskCore({
    title: "Production error needs review; GitHub refused delivery",
    description,
    userId: 332,
    creationChannel: "api",
    projectId,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectIdentifier: project.uniqueIdentifier,
    labelIds: [project.labels[0].id],
    createDrafts: false,
  });
  return { id: Number(task.id) };
}
