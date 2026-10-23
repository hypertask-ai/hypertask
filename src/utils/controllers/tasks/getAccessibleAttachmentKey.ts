import prisma from "@/lib/prisma";
import { parse } from "node-html-parser";
import { parseHypertasksStorageKeyFromUrl } from "@/lib/storage/hypertasksS3";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { extractUrlsFromContent } from "@/utils/controllers/urls/extractUrlsFromContent";
import { decodeHtmlPayloadServer } from "@/utils/controllers/pages/htmlCanvas";

function referencesKey(content: string, key: string): boolean {
  return extractUrlsFromContent(content, 0).some(
    ({ urlString }) => parseHypertasksStorageKeyFromUrl(urlString) === key,
  );
}

export async function getAccessibleAttachmentKey(
  fileSource: string,
  userId: number,
): Promise<string | null> {
  const key = parseHypertasksStorageKeyFromUrl(fileSource);
  if (!key) return null;
  let keyFragments: string[];
  try {
    keyFragments = [...new Set([key, decodeURIComponent(key)])];
  } catch {
    return null;
  }

  const rows = await prisma.attachment.findMany({
    where: { OR: [{ fileSource }, ...keyFragments.map((fragment) => ({
      fileSource: { endsWith: `/${fragment}` },
    }))] },
    select: {
      fileSource: true,
      task: { select: { id: true, projectId: true } },
      description: { select: { task: { select: { id: true, projectId: true } } } },
      comment: { select: { task: { select: { id: true, projectId: true } } } },
      chatMessage: { select: { session: { select: { userId: true } } } },
      AI_Custom_Instructions: { select: { projectId: true } },
    },
  });
  const attachments = rows.filter(
    (row) => parseHypertasksStorageKeyFromUrl(row.fileSource) === key,
  );
  const projectIds = attachments.flatMap((attachment) => [
    attachment.task?.projectId,
    attachment.description?.task?.projectId,
    attachment.comment?.task?.projectId,
    attachment.AI_Custom_Instructions?.projectId,
  ]).filter((id): id is number => id != null);
  const projectAccess = projectContentAccessWhere(userId);

  if (projectIds.length) {
    const project = await prisma.project.findFirst({
      where: { id: { in: projectIds }, ...projectAccess },
      select: { id: true },
    });
    if (project) return key;
  }

  const attachmentTaskIds = attachments.flatMap((attachment) => [
    attachment.task?.id,
    attachment.description?.task?.id,
    attachment.comment?.task?.id,
  ]).filter((id): id is number => id != null);
  const restrictedToLinkedPages = projectIds.length > 0;
  if (restrictedToLinkedPages && attachmentTaskIds.length === 0) return null;

  if (!restrictedToLinkedPages) {
    const chatAttachments = attachments.filter((attachment) => attachment.chatMessage);
    if (chatAttachments.length) {
      return chatAttachments.some((attachment) => attachment.chatMessage?.session.userId === userId)
        ? key : null;
    }

    const chatKey = /^ai-chat\/attachments\/([^/]+)\/[^/]+$/.exec(key);
    if (chatKey) {
      const session = await prisma.chatSession.findFirst({
        where: { id: chatKey[1], userId },
        select: { id: true },
      });
      if (session) return key;
    }

    const descriptions = await prisma.description.findMany({
      where: {
        task: { project: projectAccess },
        OR: keyFragments.map((fragment) => ({ content: { contains: fragment } })),
      },
      select: { content: true },
    });
    if (descriptions.some(({ content }) => referencesKey(content, key))) return key;

    const comments = await prisma.comment.findMany({
      where: {
        task: { project: projectAccess },
        OR: keyFragments.map((fragment) => ({ text: { contains: fragment } })),
      },
      select: { text: true },
    });
    if (comments.some(({ text }) => referencesKey(text, key))) return key;
  }

  const pages = await prisma.page.findMany({
    where: {
      project: projectAccess,
      archived: false,
      ...(restrictedToLinkedPages ? { AND: [{ OR: [
        { taskId: { in: attachmentTaskIds } },
        { links: { some: { taskId: { in: attachmentTaskIds } } } },
      ] }] } : {}),
      OR: [
        ...keyFragments.map((fragment) => ({ contentHtml: { contains: fragment } })),
        { contentHtml: { contains: "data-html-block" } },
      ],
    },
    select: { contentHtml: true },
  });
  for (const { contentHtml } of pages) {
    if (referencesKey(contentHtml, key)) return key;
    const blocks = parse(contentHtml).querySelectorAll("[data-html-block][data-html]");
    if (blocks.some((block) => referencesKey(
      decodeHtmlPayloadServer(block.getAttribute("data-html") ?? ""), key,
    ))) return key;
  }

  return null;
}
