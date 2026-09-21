import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskAttachFilesTool(context: ChatToolContext) {
  const { MCP_ATTACHMENT_MAX_FILES, McpAttachmentFetchError, TOOL_TASK_ID_DESCRIPTION, bufferMatchesDeclaredMime, buildMcpTaskUrl, deriveChatAttachmentFilename, errorMessage, normalizeMime, parseAndValidateAttachmentsBody, prisma, resolveTaskForTool, safeFetchAttachmentUrl, sanitizeForJson, sendStatus, tool, uploadTaskAttachmentToS3, user, withToolErrors, z } = context;
  return tool({
      description:
        "Attach files from public URLs to a task description or to an existing task comment. URL-sourced only; chat cannot upload local files or base64 data.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z
          .string()
          .optional()
          .describe(
            "Ticket number such as HTPR-1234. Prefer this when the user gives a ticket number; do not also invent task_id."
          ),
        unique_index: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Task's board-local numeric index. Only pass with project_id; do not use it by itself."
          ),
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Project/board id required with unique_index and useful to disambiguate ticket_number. Omit when only task_id is known."
          ),
        comment_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Existing comment id on the task. Only pass when attaching to that specific comment; omit to attach to the task description."
          ),
        attachments: z
          .array(
            z.object({
              url: z
                .string()
                .url()
                .describe(
                  "Public http(s) URL to fetch. Do not pass local file paths, data URLs, private intranet URLs, or already-uploaded local files."
                ),
              filename: z
                .string()
                .max(255)
                .optional()
                .describe(
                  "Optional display filename without path segments. Omit to derive a filename from the URL or MIME type."
                ),
            })
          )
          .min(1)
          .max(MCP_ATTACHMENT_MAX_FILES)
          .describe(
            "Files to attach from URLs only. Do not include content_type, base64 data, or local upload handles."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_attach_files");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const fetchedByIndex: Array<{ buffer: Buffer; contentType: string }> = [];
        const filesForValidation: Array<{
          filename: string;
          content_type: string;
          url: string;
        }> = [];

        for (const [index, attachment] of input.attachments.entries()) {
          let fetched: { buffer: Buffer; contentType: string };
          try {
            fetched = await safeFetchAttachmentUrl(attachment.url);
          } catch (error) {
            if (error instanceof McpAttachmentFetchError) {
              return { success: false, error: error.message };
            }
            throw error;
          }

          if (!bufferMatchesDeclaredMime(fetched.buffer, fetched.contentType)) {
            return {
              success: false,
              error: "Downloaded content does not match declared content type",
            };
          }

          fetchedByIndex.push(fetched);
          filesForValidation.push({
            filename:
              attachment.filename?.trim() ||
              deriveChatAttachmentFilename(
                attachment.url,
                fetched.contentType,
                index
              ),
            content_type: fetched.contentType,
            url: attachment.url,
          });
        }

        let parsed: ReturnType<typeof parseAndValidateAttachmentsBody>;
        try {
          parsed = parseAndValidateAttachmentsBody({
            task_id: task.id,
            comment_id: input.comment_id,
            files: filesForValidation,
          });
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }

        let descriptionId: string | null = null;
        let commentId: number | null = null;

        if (parsed.comment_id !== undefined) {
          const comment = await prisma.comment.findFirst({
            where: { id: parsed.comment_id, taskId: task.id },
            select: { id: true },
          });
          if (!comment) {
            return {
              success: false,
              error: "Comment not found or does not belong to this task",
            };
          }
          commentId = comment.id;
        } else {
          const description = await prisma.description.findUnique({
            where: { taskId: task.id },
            select: { id: true },
          });
          if (!description) {
            return { success: false, error: "Task description not found" };
          }
          descriptionId = description.id;
        }

        const taskForUrl = await prisma.task.findUnique({
          where: { id: task.id },
          select: { uniqueIndex: true },
        });

        const attachmentsOut: Array<{
          id: number;
          fileName: string;
          fileType: string;
          fileSize: number;
          url: string;
        }> = [];
        const failures: Array<{
          filename: string;
          source_url: string;
          error: string;
        }> = [];

        for (const [index, spec] of parsed.files.entries()) {
          const failureContext = {
            filename: spec.filename,
            source_url: input.attachments[index]?.url ?? "",
          };
          if (spec.kind !== "url") {
            failures.push({
              ...failureContext,
              error: "Chat attachment uploads only support URL-sourced files",
            });
            continue;
          }

          const fetched = fetchedByIndex[index];
          if (!fetched) {
            failures.push({
              ...failureContext,
              error: "Attachment fetch result missing",
            });
            continue;
          }

          if (
            normalizeMime(spec.contentType) !==
            normalizeMime(fetched.contentType)
          ) {
            failures.push({
              ...failureContext,
              error: `Declared content_type ${spec.contentType} does not match URL response ${fetched.contentType}`,
            });
            continue;
          }
          if (!bufferMatchesDeclaredMime(fetched.buffer, fetched.contentType)) {
            failures.push({
              ...failureContext,
              error: "Downloaded content does not match declared content type",
            });
            continue;
          }

          try {
            const url = await uploadTaskAttachmentToS3(
              fetched.buffer,
              spec.filename,
              fetched.contentType
            );

            const created = await prisma.attachment.create({
              data: {
                fileType: fetched.contentType,
                fileSource: url,
                fileName: spec.filename,
                fileSize: String(fetched.buffer.length),
                taskId: task.id,
                ...(commentId !== null ? { commentId } : {}),
                ...(descriptionId !== null ? { descriptionId } : {}),
              },
              select: {
                id: true,
                fileName: true,
                fileType: true,
                fileSize: true,
                fileSource: true,
              },
            });

            attachmentsOut.push({
              id: created.id,
              fileName: created.fileName,
              fileType: created.fileType,
              fileSize: fetched.buffer.length,
              url: created.fileSource,
            });
          } catch (error) {
            console.error("[AI chat attachments]", error);
            failures.push({
              ...failureContext,
              error: "Failed to store attachment",
            });
          }
        }

        return sanitizeForJson({
          success: attachmentsOut.length > 0,
          partial: attachmentsOut.length > 0 && failures.length > 0,
          attached_count: attachmentsOut.length,
          failed_count: failures.length,
          attachments: attachmentsOut,
          failures,
          url: taskForUrl
            ? buildMcpTaskUrl(task.projectId, taskForUrl.uniqueIndex)
            : undefined,
        });
      }),
    });
}
