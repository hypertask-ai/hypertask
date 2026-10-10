import { isBrowserRenderableImage } from "@/lib/media/browserRenderableImage";
import type { IProject, ITask } from "@/models/model";
import axios from "axios";
import { taskWriterRoute } from "@/lib/constants/APIRouteConstants";
import { buildTaskWriterRequestScope } from "./taskWriterBoardContext";
import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import { extractTitleAndDescription } from "@/utils/aiWriterUtils";
import { escapeHtml } from "@/utils/htmlEscape";
import { extractTaskWriterMedia, createTaskWriterMediaTokenFactory, restoreTaskWriterMedia } from "./taskWriterMedia";
import { startCreateTaskUpload, bindCreateTaskUploads, createTaskUploadById, retryCreateTaskUpload } from "@/lib/createTaskAttachmentUploads";
import createNewTaskGloballyAPIHandler from "@/utils/api/global/apiHelpers/createTaskGloballycontroller";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { getNewTaskViewDefaults } from "@/utils/helperFunctions/Views/NewTaskViewDefaults";

export function composeTaskBoardId(
  url: string,
  previousBoard: string | undefined,
  lastUsedBoards: Record<number, number>,
): number | undefined {
  const location = new URL(url, "https://hypertask.local");
  if (location.pathname === "/project" || location.pathname.startsWith("/project/")) {
    const board = location.searchParams.get("id") ?? location.pathname.match(/\/project\/(?:project-)?(\d+)/)?.[1];
    if (board && /^\d+$/.test(board) && Number(board) > 0) return Number(board);
  }
  const previous = previousBoard?.split("|&|")[0].match(/^project-(\d+)$/)?.[1];
  if (previous && Number(previous) > 0) return Number(previous);
  return Object.entries(lastUsedBoards).sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id)).find((id) => Number.isInteger(id) && id > 0);
}

export function composeTaskAssistantMessage(ticket: string, writerFailed = false, filledExistingTask = false, batch?: { tasks: ITask[]; failedTitles: string[] }): string {
  if (batch && (batch.tasks.length > 1 || batch.failedTitles.length)) {
    const links = batch.tasks.map((task) => `<li><a href="/detail/project-${task.projectId}/${task.uniqueIndex}">${escapeHtml(task.ticketNumber ?? `TASK-${task.uniqueIndex}`)}: ${escapeHtml(task.title ?? "")}</a></li>`).join("");
    const failures = batch.failedTitles.length
      ? `<p>Could not save these tasks. Only the linked tickets were saved:</p><ul>${batch.failedTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>` : "";
    return `<p>I ${filledExistingTask ? "saved" : "created"} ${batch.tasks.length} tickets from your note.</p><ul>${links}</ul>${failures}`;
  }
  const greeting = `I ${filledExistingTask ? "filled in" : "created"} ${ticket} from your note. Want me to refine it? I can tighten the title, add acceptance criteria or split it into sub-tasks.`;
  return writerFailed
    ? `${greeting}\n\nThe task writer was unavailable, so I kept your original text as the title and description.`
    : greeting;
}

export type ComposeTaskStage = "Reading past tickets" | "Understanding the context" | "Writing the ticket" | "Saving the ticket";

export async function createComposedTask({
  text, files, project, userId, existingTaskId, onProgress, viewProject, fields,
}: {
  text: string; files: File[]; project: IProject; userId: number; existingTaskId?: number;
  onProgress?: (stage: ComposeTaskStage) => void;
  viewProject?: IProject;
  fields?: Partial<Pick<Parameters<typeof createNewTaskGloballyAPIHandler>[0], "tags" | "assignees" | "priority" | "estimate">>;
}): Promise<{ task: ITask; writerFailed: boolean; tasks: ITask[]; failedTitles: string[] }> {
  // Resolve the destination before spending AI credits; omitting sectionId uses
  // the same first active column as the regular create-task form.
  let defaults = existingTaskId ? null : await axios.get("/api/tasks/createGlobally", {
    params: { projectId: project.id, position: "top" },
  });
  if (!existingTaskId && !defaults?.data?.sectionId) throw new Error("This board has no column to create a task in.");
  const uploads = await Promise.all(files.map(async (file) => {
    let upload = startCreateTaskUpload(file);
    if (createTaskUploadById(upload.id)?.status === "upload-failed") {
      retryCreateTaskUpload(upload.id);
      upload = startCreateTaskUpload(file);
    }
    const { url } = await upload.promise;
    return { fileName: file.name, url, mimeType: file.type };
  }));
  const rawDescription = `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>` +
    uploads.map(({ url, fileName, mimeType }) => isBrowserRenderableImage(mimeType, fileName)
      ? `<p><img src="${escapeHtml(url)}" alt="${escapeHtml(fileName)}"></p>`
      : `<p><a href="${escapeHtml(url)}">${escapeHtml(fileName)}</a></p>`).join("");
  let title = text;
  let description = rawDescription;
  let writerFailed = false;
  let drafts: { title: string; description: string }[] = [];
  try {
    const media = extractTaskWriterMedia(rawDescription, createTaskWriterMediaTokenFactory(rawDescription, text));
    onProgress?.("Reading past tickets");
    const response = await fetch(taskWriterRoute, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...buildTaskWriterRequestScope(project, deriveCurrentBoardBilling(project)),
        PROMPT: `Write a task title and description from this note in the board's style.\n\n${media.html}`,
        userRetrievalTexts: [text],
        customInstructions: project.ai_custom_instructions?.[0]?.customInstruction ?? "",
        sourceSelected: project.ai_custom_instructions?.[0]?.source_selected ?? "openai",
        modelSelected: project.ai_custom_instructions?.[0]?.model_selected ?? undefined,
        aiMode: "AiTaskWriter",
        requestKind: "compose-task",
        ...(existingTaskId ? { existingTaskId } : {}),
        images64: uploads.filter((file) => isBrowserRenderableImage(file.mimeType, file.fileName)),
        taskDescription: media.html,
      }),
    });
    if (!response.ok) throw new Error("Task writer unavailable");
    let html = "";
    if (onProgress && response.body) {
      // Headers arrive after server retrieval and prompt preparation. The model
      // can use that context while we wait for its first visible output.
      onProgress("Understanding the context");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedText = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value.length) continue;
          html += decoder.decode(value, { stream: true });
          if (!receivedText && html.includes("<")) {
            receivedText = true;
            onProgress("Writing the ticket");
          }
        }
        html += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    } else {
      html = await response.text();
    }
    // This endpoint streams raw HTML on success, but SSE error frames can arrive
    // after a 200. A partial answer must not be mistaken for a completed ticket.
    if (/^event:\s*(?:error|done)\b/m.test(html)) throw new Error("Task writer interrupted");
    if (response.headers?.get("content-type")?.includes("application/json")) {
      const output = JSON.parse(html);
      if (!Array.isArray(output.tasks) || !output.tasks.length) throw new Error("Task writer returned no tickets");
      drafts = output.tasks.slice(0, 10).map((draft: { title: string; description: string }) => {
        if (typeof draft?.title !== "string" || !draft.title.trim() ||
            typeof draft.description !== "string" || !draft.description.trim()) {
          throw new Error("Task writer returned an incomplete ticket");
        }
        return { title: draft.title, description: draft.description };
      });
    } else {
      const written = extractTitleAndDescription(html);
      if (!written.title || !written.description.trim()) throw new Error("Task writer returned an incomplete ticket");
      drafts = [{ title: written.title, description: written.description }];
    }
    drafts = drafts.map((draft) => {
      let body = restoreTaskWriterMedia(draft.description, media.media);
      for (const file of uploads) {
        if (!isBrowserRenderableImage(file.mimeType, file.fileName) && !body.includes(file.url)) {
          body += `<p><a href="${escapeHtml(file.url)}">${escapeHtml(file.fileName)}</a></p>`;
        }
      }
      return { title: draft.title, description: body };
    });
    title = drafts[0].title;
    description = drafts[0].description;
  } catch {
    writerFailed = true;
    drafts = [];
  }
  if (!drafts.length) drafts = [{ title, description }];
  if (existingTaskId && drafts.length > 1) {
    defaults = await axios.get("/api/tasks/createGlobally", { params: { projectId: project.id, position: "top" } });
    if (!defaults?.data?.sectionId) throw new Error("This board has no column to create a task in.");
  }
  onProgress?.("Saving the ticket");
  const filters = !existingTaskId && viewProject?.id === project.id
    ? getActiveFiltersFromProject(viewProject) : undefined;
  const viewDefaults = filters?.addedFilters.length ? getNewTaskViewDefaults(filters) : undefined;
  const taskFields = { assignees: [], ...fields };
  if (viewDefaults) {
    const tags = [...(taskFields.tags ?? []), ...(viewDefaults.tags ?? [])];
    if (tags.length) taskFields.tags = tags.filter((tag, index) => tags.findIndex((other) => other.id === tag.id) === index);
    const assignees = [...taskFields.assignees, ...viewDefaults.assignees];
    taskFields.assignees = assignees.filter((person, index) => assignees.findIndex((other) => other.id === person.id) === index);
    if (taskFields.priority == null && viewDefaults.priority) taskFields.priority = viewDefaults.priority;
    if (taskFields.estimate == null && viewDefaults.estimate) taskFields.estimate = viewDefaults.estimate;
  }
  const tasks: ITask[] = [];
  const failedTitles: string[] = [];
  for (const [index, draft] of drafts.entries()) {
    try {
      const created = await createNewTaskGloballyAPIHandler({
        userId, projectId: project.id, projectIdentifier: project.uniqueIdentifier ?? "TASK",
        title: draft.title, ...{ description: draft.description },
        sectionId: defaults?.data.sectionId, section_title: defaults?.data.section,
        ranking: defaults?.data.ranking, ...taskFields, requestKind: "compose-task",
        ...(existingTaskId && index === 0 ? { existingTaskId } : {}),
      });
      const task = created?.resposne?.newTask;
      if (created?.error || !task?.id) throw new Error("Couldn’t create the task. Your note is still here. Try again.");
      tasks.push(task);
      bindCreateTaskUploads(task.id, files);
    } catch (error) {
      if (drafts.length === 1 || (existingTaskId && index === 0)) throw error;
      failedTitles.push(draft.title);
    }
  }
  if (!tasks.length) throw new Error("Couldn’t create the tasks. Your note is still here. Try again.");
  return { task: tasks[0], writerFailed, tasks, failedTitles };
}
