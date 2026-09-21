import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { extractCanvasText } from "@/utils/controllers/pages/htmlCanvas";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const REPORT_BODY_MAX = 500_000;
export const REPORT_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const REPORT_CAPABILITIES = `The body is one self-contained HTML document or fragment. Inline <style> and inline <script> both run. No network at all: CSP is connect-src 'none' and script-src 'unsafe-inline', so fetch/XHR fail and external <script src="...cdn..."> files never load. Chart libraries cannot be used; bake every number into the HTML and draw charts as inline SVG or CSS. Images must use data: URIs or https: URLs. Do not use forms or nested iframes. The frame has a unique opaque origin with no cookies, localStorage, or access to the app or its data. Height is auto-reported to the parent, so do not set a fixed body height. The frame cannot see app CSS variables; use a white background, a system font stack, #111 text, #6b7280 muted text, #e5e7eb borders, and 4px radii. Refresh a report by regenerating and updating its body.`;

type ReportField = "title" | "slug" | "bodyHtml";

export class ReportValidationError extends Error {
  readonly field: ReportField;

  constructor(field: ReportField, message: string) {
    super(`${message}\n\n${REPORT_CAPABILITIES}`);
    this.name = "ReportValidationError";
    this.field = field;
  }
}

export function normalizeReportSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export function validateReportBody(bodyHtml: string): void {
  if (typeof bodyHtml !== "string") {
    throw new ReportValidationError("bodyHtml", "Body must be a string.");
  }
  if (bodyHtml.length > REPORT_BODY_MAX) {
    throw new ReportValidationError(
      "bodyHtml",
      `Body must be ${REPORT_BODY_MAX.toLocaleString("en-US")} characters or fewer.`
    );
  }
}

function validateTitle(title: string): string {
  if (typeof title !== "string" || !title.trim()) {
    throw new ReportValidationError("title", "Title is required.");
  }
  const normalized = title.trim();
  if (normalized.length > 200) {
    throw new ReportValidationError(
      "title",
      "Title must be 200 characters or fewer."
    );
  }
  return normalized;
}

// Slugs that already name a built-in report route under /report/project-N/.
// A stored report with one of these slugs would be shadowed by the static
// segment and could never render, so reject it at the write path.
export const RESERVED_REPORT_SLUGS = ["velocity"];

export function validateSlug(slug: string): string {
  const normalized = typeof slug === "string" ? normalizeReportSlug(slug) : "";
  if (!normalized || !REPORT_SLUG_RE.test(normalized)) {
    throw new ReportValidationError(
      "slug",
      "Slug is required and must contain only lowercase letters, numbers, and single dashes."
    );
  }
  if (RESERVED_REPORT_SLUGS.includes(normalized)) {
    throw new ReportValidationError(
      "slug",
      `"${normalized}" is a built-in report and cannot be used as a slug. Pick a different one.`
    );
  }
  return normalized;
}

async function getAccessibleProject(
  userId: number,
  projectId: number,
  agentId?: string | null
) {
  return prisma.project.findFirst({
    where: { id: projectId, ...getProjectWhere(userId, agentId) },
    select: { id: true, title: true, name: true },
  });
}

const reportInclude = {
  project: { select: { id: true, title: true, name: true } },
  createdBy: {
    select: { displayName: true, email: true, photoURL: true },
  },
  agent: { select: { displayName: true, photoURL: true } },
} satisfies Prisma.ReportInclude;

type ReportWithCreator = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

export type ReportCreator = {
  kind: "agent" | "user" | "unknown";
  name: string;
  photoURL?: string;
};

function reportCreator(report: ReportWithCreator): ReportCreator {
  if (report.agentId) {
    return {
      kind: "agent",
      name: report.agent?.displayName ?? "Unknown agent",
      ...(report.agent?.photoURL ? { photoURL: report.agent.photoURL } : {}),
    };
  }
  if (report.createdBy) {
    return {
      kind: "user",
      name: report.createdBy.displayName ?? report.createdBy.email,
      ...(report.createdBy.photoURL
        ? { photoURL: report.createdBy.photoURL }
        : {}),
    };
  }
  return { kind: "unknown", name: "Unknown" };
}

export async function createReport({
  userId,
  agentId,
  projectId,
  slug,
  title,
  description,
  bodyHtml,
}: {
  userId: number;
  agentId?: string | null;
  projectId: number;
  slug: string;
  title: string;
  description?: string | null;
  bodyHtml: string;
}) {
  const normalizedTitle = validateTitle(title);
  const normalizedSlug = validateSlug(slug);
  validateReportBody(bodyHtml);

  const project = await getAccessibleProject(userId, projectId, agentId);
  if (!project) return null;

  try {
    return await prisma.report.create({
      data: {
        projectId,
        slug: normalizedSlug,
        title: normalizedTitle,
        description: description ?? null,
        bodyHtml,
        bodyText: extractCanvasText(bodyHtml),
        createdById: userId,
        agentId: agentId ?? null,
      },
      include: reportInclude,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ReportValidationError(
        "slug",
        `A report with the slug "${normalizedSlug}" already exists on this board.`
      );
    }
    throw error;
  }
}

export async function updateReport({
  userId,
  agentId,
  projectId,
  slug,
  title,
  description,
  bodyHtml,
}: {
  userId: number;
  agentId?: string | null;
  projectId: number;
  slug: string;
  title?: string;
  description?: string | null;
  bodyHtml?: string;
}) {
  const normalizedSlug = validateSlug(slug);
  const report = await prisma.report.findFirst({
    where: {
      projectId,
      slug: normalizedSlug,
      project: getProjectWhere(userId, agentId),
    },
    select: { id: true },
  });
  if (!report) return null;

  const data: Prisma.ReportUpdateInput = {};
  if (title !== undefined) data.title = validateTitle(title);
  if (description !== undefined) data.description = description;
  if (bodyHtml !== undefined) {
    validateReportBody(bodyHtml);
    data.bodyHtml = bodyHtml;
    data.bodyText = extractCanvasText(bodyHtml);
  }

  return prisma.report.update({
    where: { id: report.id },
    data,
    include: reportInclude,
  });
}

export async function getReport({
  userId,
  agentId,
  projectId,
  slug,
}: {
  userId: number;
  agentId?: string | null;
  projectId: number;
  slug: string;
}) {
  const normalizedSlug = validateSlug(slug);
  const report = await prisma.report.findFirst({
    where: {
      projectId,
      slug: normalizedSlug,
      project: getProjectWhere(userId, agentId),
    },
    include: reportInclude,
  });
  if (!report) return null;

  return {
    ...report,
    boardName: report.project.title ?? report.project.name,
    creator: reportCreator(report),
    href: getReportUrl(projectId, normalizedSlug),
  };
}

export async function listReports({
  userId,
  agentId,
  projectId,
}: {
  userId: number;
  agentId?: string | null;
  projectId: number;
}) {
  const project = await getAccessibleProject(userId, projectId, agentId);
  if (!project) return null;

  return prisma.report.findMany({
    where: { projectId },
    include: reportInclude,
    orderBy: { updatedAt: "desc" },
  });
}

export async function deleteReport({
  userId,
  agentId,
  projectId,
  slug,
}: {
  userId: number;
  agentId?: string | null;
  projectId: number;
  slug: string;
}) {
  const normalizedSlug = validateSlug(slug);
  const report = await prisma.report.findFirst({
    where: {
      projectId,
      slug: normalizedSlug,
      project: getProjectWhere(userId, agentId),
    },
    select: { id: true },
  });
  if (!report) return null;

  return prisma.report.delete({ where: { id: report.id } });
}

export function getReportUrl(projectId: number, slug: string): string {
  return `/report/project-${projectId}/${slug}`;
}

export async function listAllReportsForUser(userId: number) {
  const [reports, projects] = await Promise.all([
    prisma.report.findMany({
      where: { project: getProjectWhere(userId) },
      include: reportInclude,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.findMany({
      where: getProjectWhere(userId),
      select: { id: true, title: true, name: true },
    }),
  ]);

  return {
    reports: reports.map((report) => ({
      id: report.id,
      slug: report.slug,
      title: report.title,
      description: report.description,
      projectId: report.projectId,
      boardName: report.project.title ?? report.project.name,
      updatedAt: report.updatedAt,
      href: getReportUrl(report.projectId, report.slug),
      creator: reportCreator(report),
    })),
    builtins: projects
      .map((project) => ({
        projectId: project.id,
        boardName: project.title ?? project.name,
        title: "Velocity" as const,
        description: "Throughput, lead time, and who is active" as const,
        href: `/report/project-${project.id}/velocity`,
      }))
      .sort((a, b) => a.boardName.localeCompare(b.boardName)),
  };
}
