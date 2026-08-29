import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { IUser } from "@/models/model";
import { broadcastInboxChange } from "@/lib/realtime/server";
import { escapeHtml } from "@/utils/htmlEscape";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { HYPERTASKS_STORAGE_PUBLIC_BASE_URL } from "@/lib/storage/hypertasksS3";
import { NextRequest, NextResponse } from "next/server";

// Product board where all in-app feedback lands (HTPR-5646): the dedicated
// feedback board (2101) had its own drain agent, which was deleted, so
// feedback now goes straight into the one queue that's still being worked.
const FEEDBACK_PROJECT_ID = 15;
const FEEDBACK_SECTION_TITLE = "Bugs";
const FEEDBACK_LABEL_VALUE = "user-feedback";
const FEEDBACK_PRIORITY_INDEX = 1; // Urgent, see PriorityConstants
const MAX_FEEDBACK_LENGTH = 5000;
// The feedback form now submits Tiptap HTML, which is bulkier than the plain
// text it replaces (tags, pasted-image <img> markup) - give that path more room.
const MAX_FEEDBACK_HTML_LENGTH = 20000;
const MAX_TITLE_LENGTH = 80;
const MAX_CONTEXT_LENGTH = 300;
const FEEDBACK_KINDS = ["Bug", "Idea", "Question", "Praise"] as const;
// The picker accepts image/*, so the link can be any of these. The HEAD check
// below is what actually decides; this just rejects the obvious .html case early.
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];
const IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
];

type FeedbackContext = {
  pathname?: string;
  pageTitle?: string;
  userAgent?: string;
  appVersion?: string;
  screenshotUrl?: string;
};

function isOwnStorageUrl(value: string) {
  try {
    const url = new URL(value);
    const storageUrl = new URL(HYPERTASKS_STORAGE_PUBLIC_BASE_URL);
    const storagePath = storageUrl.pathname.replace(/\/+$/, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.host === storageUrl.host &&
      (!storagePath || url.pathname.startsWith(`${storagePath}/`)) &&
      // Same host is not enough: the generic upload endpoint accepts any file, so
      // an .html upload would become a trusted-looking "Screenshot" link.
      IMAGE_EXTENSIONS.some((extension) =>
        url.pathname.toLowerCase().endsWith(extension)
      )
    );
  } catch {
    return false;
  }
}

// The .png suffix is the attacker's to choose: the upload endpoint stores the
// client's Content-Type verbatim, so a file named x.png can still be served as
// text/html. Ask the object what it actually is before we link it.
async function servesAnImage(value: string) {
  try {
    const response = await fetch(value, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    // An allowlist, not startsWith("image/"): image/svg+xml is an image type that
    // executes script when opened, and the upload endpoint stores whatever
    // Content-Type the client sends, so SVG bytes named .png would otherwise pass.
    const contentType = (response.headers.get("content-type") || "")
      .toLowerCase()
      .split(";")[0]
      .trim();
    return response.ok && IMAGE_CONTENT_TYPES.includes(contentType);
  } catch {
    return false;
  }
}

// No server-safe HTML sanitizer lives in this repo yet: the one library that
// exists (isomorphic-dompurify, via sanitizeAiHtml) pulls in jsdom and has
// previously crashed a nodejs API route at module load (see toStoredHtml.ts).
// This is a narrow, targeted strip rather than a general sanitizer: no
// <script>, no inline event handlers, no javascript: URIs.
function sanitizeFeedbackHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)(\s*=\s*)("|')\s*javascript:[^"']*\3/gi, '$1$2$3#$3');
}

// Tiptap serializes an empty editor as "<p></p>"; mirrors isFeedbackTextEmpty
// in FeedbackForm.tsx, which the client already uses to disable submission.
function isEmptyFeedbackHtml(html: string): boolean {
  return html.replace(/<p>\s*<\/p>/gi, "").trim().length === 0;
}

function feedbackDescription(
  text: string,
  isHtml: boolean,
  user: { id: number; displayName: string | null; email: string },
  context: FeedbackContext
) {
  const body = isHtml
    ? sanitizeFeedbackHtml(text)
    : text
        .split(/\r\n?|\n/)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
  const displayName = user.displayName?.trim() || "Unknown user";
  const contextItems = [
    ["Page", context.pathname],
    ["Title", context.pageTitle],
    ["User agent", context.userAgent],
    ["App version", context.appVersion],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  const contextBlock = contextItems.length
    ? `<p><strong>Context:</strong></p><ul>${contextItems
        .map(
          ([label, value]) =>
            `<li><strong>${label}:</strong> ${escapeHtml(value)}</li>`
        )
        .join("")}</ul>`
    : "";
  const screenshot = context.screenshotUrl
    ? `<p><a href="${escapeHtml(context.screenshotUrl)}">Screenshot</a></p>`
    : "";

  return `${body}<p><strong>From:</strong> ${escapeHtml(displayName)} (${escapeHtml(user.email)}) — userId ${user.id}</p>${contextBlock}${screenshot}`;
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const notify = body?.notify === undefined ? true : body.notify;
  if (typeof notify !== "boolean") {
    return NextResponse.json(
      { success: false, error: "Notify must be a boolean" },
      { status: 400 }
    );
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  // The editor sends Tiptap HTML (starts with a tag); older/plain callers still
  // send bare text. Each path gets its own length ceiling and emptiness check.
  const isHtml = text.startsWith("<");
  const textIsEmpty = isHtml ? isEmptyFeedbackHtml(text) : !text;
  const maxLength = isHtml ? MAX_FEEDBACK_HTML_LENGTH : MAX_FEEDBACK_LENGTH;
  if (textIsEmpty || text.length > maxLength) {
    return NextResponse.json(
      {
        success: false,
        error: `Feedback must be between 1 and ${maxLength} characters`,
      },
      { status: 400 }
    );
  }
  const contextFields = [
    "pathname",
    "pageTitle",
    "userAgent",
    "appVersion",
    "screenshotUrl",
  ] as const;
  if (
    contextFields.some(
      (field) =>
        body?.[field] !== undefined &&
        (typeof body[field] !== "string" || body[field].length > MAX_CONTEXT_LENGTH)
    )
  ) {
    return NextResponse.json(
      { success: false, error: "Feedback context fields must be strings up to 300 characters" },
      { status: 400 }
    );
  }
  const kind = body?.kind ?? "Bug";
  if (
    typeof kind !== "string" ||
    !FEEDBACK_KINDS.some((feedbackKind) => feedbackKind === kind)
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid feedback kind" },
      { status: 400 }
    );
  }
  if (
    body?.screenshotUrl &&
    (!isOwnStorageUrl(body.screenshotUrl) ||
      !(await servesAnImage(body.screenshotUrl)))
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid screenshot URL" },
      { status: 400 }
    );
  }
  const context = Object.fromEntries(
    contextFields.map((field) => [field, body?.[field]?.trim() || undefined])
  ) as FeedbackContext;

  try {
    const [user, project, label] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, displayName: true, email: true },
      }),
      // ponytail: This deliberately skips getProjectWhere because submitters are not members of the internal product board.
      prisma.project.findFirst({
        where: { id: FEEDBACK_PROJECT_ID, status: "Normal" },
        select: {
          uniqueIdentifier: true,
          ownerId: true,
          section: {
            where: {
              deleted: false,
              visibility: true,
              section_title: FEEDBACK_SECTION_TITLE,
            },
            take: 1,
            select: { id: true, section_title: true },
          },
        },
      }),
      prisma.label.findFirst({
        where: { projectId: FEEDBACK_PROJECT_ID, value: FEEDBACK_LABEL_VALUE },
        select: { id: true },
      }),
    ]);

    const section = project?.section[0];
    if (!user || !project?.uniqueIdentifier || !section) {
      throw new Error("Feedback destination is not configured");
    }
    const labelId =
      label?.id ??
      (
        await prisma.label.create({
          data: { value: FEEDBACK_LABEL_VALUE, projectId: FEEDBACK_PROJECT_ID },
          select: { id: true },
        })
      ).id;

    // Titles need plain text: HTML tags in the first line would otherwise show
    // up literally (e.g. "Bug: <p>Something broke</p>").
    const titleSource = isHtml
      ? text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : text;
    const { task } = await createTaskCore({
      title: `${kind}: ${titleSource.split(/\r\n?|\n/, 1)[0].trim()}`.slice(
        0,
        MAX_TITLE_LENGTH
      ),
      description: `${feedbackDescription(text, isHtml, user, context)}${
        notify ? "<p><strong>Notify:</strong> yes</p>" : ""
      }`,
      userId: user.id,
      projectId: FEEDBACK_PROJECT_ID,
      sectionId: section.id,
      sectionTitle: section.section_title,
      projectIdentifier: project.uniqueIdentifier,
      // ponytail: Submitters cannot access the destination board, so per-user task drafts would be orphaned.
      createDrafts: false,
      labelIds: [labelId],
      priorityIndex: FEEDBACK_PRIORITY_INDEX,
    });

    // Assign the board owner + members so new feedback lands in their inbox
    // through the standard Assigned notification pipeline (inbox + push + email).
    const members = await prisma.member.findMany({
      where: {
        projectId: FEEDBACK_PROJECT_ID,
        agentId: null,
        status: "Accepted",
      },
      select: { userId: true },
    });
    const recipientIds = [
      ...new Set([project.ownerId, ...members.map((member) => member.userId)]),
    ];
    const deliveries = await Promise.allSettled(
      recipientIds.map(async (recipientId) => {
        const result = await assigneesAssign(
          user as IUser,
          recipientId,
          task.id,
          undefined,
          undefined,
          { intent: "assign" }
        );
        if (result.status !== 200) {
          throw new Error(`assign failed with status ${result.status}`);
        }
        // The assign pipeline deliberately skips self-assign notifications, but
        // feedback must reach the inbox even when a board recipient submits it.
        // TaskMovedToInbox, not Assigned: the inbox drops Assigned rows whose actor
        // is the reader (inboxConfig.selfTriggeredHidden), so a self-authored one is
        // written and filtered straight back out. TaskMovedToInbox is the type that
        // config deliberately keeps for "a task landed in your own inbox", which is
        // exactly what this is.
        if (recipientId === user.id) {
          const assign = (result.json as any).body?.find(
            (a: any) => a.userId === user.id && !a.agentId
          );
          await prisma.notification.create({
            data: {
              assignId: assign?.id,
              userId: user.id,
              taskId: task.id,
              projectId: FEEDBACK_PROJECT_ID,
              type: "TaskMovedToInbox",
              fromUserId: user.id,
            },
          });
          void broadcastInboxChange(user.id, { originUserId: user.id });
        }
      })
    );
    deliveries.forEach((delivery, index) => {
      if (delivery.status === "rejected") {
        console.error(
          `Feedback inbox delivery failed for user ${recipientIds[index]}`,
          delivery.reason
        );
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to create feedback task", error);
    return NextResponse.json(
      { success: false, error: "Unable to send feedback" },
      { status: 500 }
    );
  }
}
