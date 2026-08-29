import { generateText, type UserContent } from "ai";
import { parse } from "node-html-parser";

import prisma from "@/lib/prisma";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getByokOrTeamGatewayApiKeyForProvider } from "@/app/api/ai/_lib/byokKeys";
import {
  buildCustomInstructionFileRows,
  deleteCustomInstructionFileInTurbopuffer,
  listCustomInstructionFileRows,
  searchCustomInstructionFiles,
  upsertCustomInstructionFileRowsToTurbopuffer,
  type TurbopufferCustomInstructionFileRow,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";
import {
  BOARD_MEMORY_CONFIG_FILE_TYPE,
  BOARD_MEMORY_CONFIG_SOURCE,
  formatBoardMemoryPromptContext,
  isBoardMemoryFactRow,
  isReservedBoardMemoryFileType,
} from "@/app/api/ai/_lib/boardMemoryContract";
import {
  aiUsageProviderForCredential,
  gatewayProviderOptionsForModel,
  isAiGatewayEnabled,
  resolveAiModel,
  type AiGatewayTags,
} from "@/app/api/ai/_lib/modelProvider";

const CUSTOM_INSTRUCTION_MODEL = "gpt-5.4-mini";
const CUSTOM_INSTRUCTION_VISION_MODEL = "gpt-5.5";
const MAX_DIRECT_TEXT_CHARS = 80_000;

type ProcessUrlResult = {
  source: string;
  fileName: string;
  fileType: string;
  rows: TurbopufferCustomInstructionFileRow[];
};

export class ProjectAccessError extends Error {
  constructor() {
    super("Project not found or access denied");
    this.name = "ProjectAccessError";
  }
}

export async function assertProjectAccess(userId: number, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...getProjectWhere(userId),
    },
    select: { id: true, teamId: true },
  });

  if (!project) {
    throw new ProjectAccessError();
  }

  return project;
}

export async function uploadCustomInstructionFiles(args: {
  userId: number;
  projectId: number;
  teamId?: string | null;
  urls: string[];
}) {
  const project = await assertProjectAccess(args.userId, args.projectId);
  const teamId = project.teamId || "";
  const gatewayTags: AiGatewayTags = {
    teamId,
    projectId: project.id,
    userId: args.userId,
  };
  const uniqueUrls = Array.from(new Set(args.urls.filter(Boolean)));
  const processed: ProcessUrlResult[] = [];
  const gatewayApiKey = await getByokOrTeamGatewayApiKeyForProvider(
    "openai",
    undefined,
    {
      projectId: project.id,
      userId: args.userId,
    }
  );

  for (const url of uniqueUrls) {
    try {
      const extracted = await extractCustomInstructionText(
        url,
        gatewayApiKey,
        gatewayTags,
        {
          userId: args.userId,
          teamId: project.teamId,
          projectId: project.id,
        }
      );
      const rows = buildCustomInstructionFileRows({
        projectId: project.id,
        teamId,
        source: url,
        fileName: extracted.fileName,
        fileType: extracted.fileType,
        content: extracted.text,
      });
      await upsertCustomInstructionFileRowsToTurbopuffer(rows);
      processed.push({
        source: url,
        fileName: extracted.fileName,
        fileType: extracted.fileType,
        rows,
      });
    } catch (error) {
      console.error("[customInstructions] upload failed for URL:", url, error);
    }
  }

  return {
    success: true,
    document_count: processed.reduce((count, item) => count + item.rows.length, 0),
    files: processed.map((item) => ({
      source: item.source,
      fileName: item.fileName,
      fileType: item.fileType,
      chunks: item.rows.length,
    })),
  };
}

export async function deleteCustomInstructionFile(args: {
  userId: number;
  projectId: number;
  sourceUrl: string;
  fileIdToRemove?: number | null;
}) {
  await assertProjectAccess(args.userId, args.projectId);
  await deleteCustomInstructionFileInTurbopuffer({
    projectId: args.projectId,
    source: args.sourceUrl,
  });

  if (args.fileIdToRemove) {
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: args.fileIdToRemove,
        fileSource: args.sourceUrl,
        AI_Custom_Instructions: {
          projectId: args.projectId,
        },
      },
      select: { id: true },
    });

    if (attachment) {
      await prisma.attachment.delete({ where: { id: attachment.id } });
    }
  }

  return { success: true };
}

export async function retrieveCustomInstructionFileContext(args: {
  projectId: number;
  prompt: string;
}) {
  let boardMemoryEnabled = false;
  try {
    const configRows = await listCustomInstructionFileRows({
      projectId: args.projectId,
      fileType: BOARD_MEMORY_CONFIG_FILE_TYPE,
      topK: 1,
    });
    boardMemoryEnabled = configRows.some(
      (row) => row.source === BOARD_MEMORY_CONFIG_SOURCE
    );
  } catch {
    // Memory is optional prompt context. Its status lookup already logs storage
    // failures, and ordinary custom instructions should remain available.
  }
  const rows = await searchCustomInstructionFiles({
    projectId: args.projectId,
    searchQuery: args.prompt,
    topK: 8,
    includeBoardMemory: boardMemoryEnabled,
  });

  if (rows.length === 0) return "";

  return rows
    .map(
      (row) => isBoardMemoryFactRow(row)
        ? formatBoardMemoryPromptContext(row.content)
        : `Custom instruction file: ${row.fileName}\nSource: ${row.source}\nContent: ${row.content}`
    )
    .join("\n\n");
}

async function extractCustomInstructionText(
  url: string,
  gatewayApiKey?: string,
  gatewayTags?: AiGatewayTags,
  usageContext?: {
    userId: number;
    teamId?: string | null;
    projectId?: number | null;
  }
) {
  const fileName = getFileNameFromUrl(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const headerContentType = response.headers.get("content-type") || "";
  const inferredContentType = contentTypeFromFileName(fileName);
  const contentType =
    headerContentType && headerContentType !== "application/octet-stream"
      ? headerContentType
      : inferredContentType;
  if (isReservedBoardMemoryFileType(contentType)) {
    throw new Error("Reserved board memory file type");
  }
  const extension = getExtension(fileName);

  if (isTextLike(contentType, extension)) {
    const text = await response.text();
    return {
      fileName,
      fileType: contentType || extension || "text",
      text: normalizeTextFromType(text, contentType, extension),
    };
  }

  return {
    fileName,
    fileType: contentType || extension || "application/octet-stream",
    text: await extractBinaryDocumentTextWithOpenAI(
      url,
      contentType,
      fileName,
      gatewayApiKey,
      gatewayTags,
      usageContext
    ),
  };
}

async function extractBinaryDocumentTextWithOpenAI(
  url: string,
  mediaType: string,
  fileName: string,
  gatewayApiKey?: string,
  gatewayTags?: AiGatewayTags,
  usageContext?: {
    userId: number;
    teamId?: string | null;
    projectId?: number | null;
  }
) {
  if (!gatewayApiKey && !isAiGatewayEnabled()) {
    return "";
  }

  const isImage = mediaType.startsWith("image/");
  const prompt = isImage
    ? "Describe this image in clear, searchable prose for use as AI custom-instruction context. Include visible text, decisions, data, diagrams, and notable details."
    : "Extract the useful textual content from this document for use as AI custom-instruction context. Preserve decisions, requirements, examples, data, and headings. Omit boilerplate.";
  const content: UserContent = [
    { type: "text", text: `${prompt}\n\nFile: ${fileName}` },
    { type: "file", mediaType, data: new URL(url) },
  ];
  const model = resolveAiModel(
    "openai",
    isImage ? CUSTOM_INSTRUCTION_VISION_MODEL : CUSTOM_INSTRUCTION_MODEL,
    gatewayApiKey
  );

  const result = await generateText({
    model,
    messages: [{ role: "user", content }],
    maxRetries: 2,
    maxOutputTokens: 6000,
    providerOptions: gatewayProviderOptionsForModel(
      model,
      "custom-instructions",
      gatewayTags
    ),
  });

  if (usageContext) {
    await logAiUsage({
      ...usageContext,
      provider: aiUsageProviderForCredential("openai", gatewayApiKey),
      model: isImage
        ? CUSTOM_INSTRUCTION_VISION_MODEL
        : CUSTOM_INSTRUCTION_MODEL,
      feature: "custom-instructions",
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
    });
  }

  return result.text.trim();
}

function normalizeTextFromType(text: string, contentType: string, extension: string) {
  let normalized = text;
  if (contentType.includes("html") || extension === "html") {
    normalized = parse(text).text;
  } else if (contentType.includes("json") || extension === "json") {
    try {
      normalized = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      normalized = text;
    }
  }

  return normalized.replace(/\s+/g, " ").trim().slice(0, MAX_DIRECT_TEXT_CHARS);
}

function isTextLike(contentType: string, extension: string) {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("csv") ||
    ["txt", "json", "csv", "md", "markdown", "html", "htm"].includes(extension)
  );
}

function getFileNameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "custom-instruction-file";
  } catch {
    return "custom-instruction-file";
  }
}

function getExtension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match?.[1]?.toLowerCase() || "";
}

function contentTypeFromFileName(fileName: string) {
  const extension = getExtension(fileName);
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "html":
    case "htm":
      return "text/html";
    case "txt":
    case "md":
    case "markdown":
      return "text/plain";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}
