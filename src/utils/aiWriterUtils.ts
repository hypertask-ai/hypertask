import {
  EstimateConstants,
  IEstimateConstants,
  IPrioritiesConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import { IAgent, ILabel, IUser } from "@/models/model";
import { isDuplicateNoteTitle } from "@/lib/ai/taskWriterDuplicateGuard";
import type {
  IForm,
  TSectionPayload,
} from "@/models/CreateTaskModalModels/model";
import type { ITaskWriterAttachment } from "@/models/AI_Task_writer_model";

export interface IExtractedTaskProperties {
  title: string | null;
  description: string;
  priority?: IPrioritiesConstants;
  estimate?: IEstimateConstants;
  tags?: ILabel[];
  status?: TSectionPayload;
  assignees?: (IUser | IAgent)[];
  dueDate?: Date;
  startDate?: Date;
}

const hasDescriptionContent = (value: string) => {
  if (/<(?:audio|embed|iframe|img|object|video)\b/i.test(value)) return true;
  return Boolean(
    value
      .replace(/<br\s*\/?>(?=.)/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(?:nbsp|#160|#xA0);/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
};

export function mergeMobileCreateTaskWriterResult(
  current: IForm,
  result: IExtractedTaskProperties,
  attachments: ITaskWriterAttachment[] | undefined,
  openingSectionId: number | undefined,
): IForm {
  const canReplaceSection =
    current.status?.sectionId === undefined ||
    current.status.sectionId === openingSectionId;
  const mappedAttachments = attachments?.map((attachment, index) => ({
    id: index,
    file: {
      name: attachment.file.name,
      size: attachment.file.size,
      type: attachment.file.type,
      source: attachment.preview,
    },
  }));

  return {
    ...current,
    title: current.title.trim() ? current.title : result.title?.trim() ?? "",
    description: hasDescriptionContent(current.description)
      ? current.description
      : result.description,
    priority: current.priority ?? result.priority,
    estimate: current.estimate ?? result.estimate,
    tags: current.tags?.length ? current.tags : result.tags,
    status:
      canReplaceSection && result.status
        ? { ...result.status, position: result.status.position ?? "top" }
        : current.status,
    assignees: current.assignees.length
      ? current.assignees
      : result.assignees ?? [],
    dueDate: current.dueDate ?? result.dueDate,
    startDate: current.startDate ?? result.startDate,
    attachments: current.attachments.length
      ? current.attachments
      : mappedAttachments ?? [],
  };
}

export function extractTitleAndDescription(htmlString: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const h1Element = doc.getElementById("ai-generated-task-title");
  const rawTitle = h1Element?.textContent?.trim() || null;
  const title = isDuplicateNoteTitle(rawTitle) ? null : rawTitle;
  doc.querySelectorAll('[id^="ai-generated-task-"]').forEach((element) => {
    element.remove();
  });
  const description = stripPropertyMetadataFromDescription(doc.body.innerHTML);
  return { title, description };
}

interface ISectionLike {
  id?: number;
  section_title?: string;
}

const PROPERTY_LINE_REGEX =
  /^(Priority|Size|Status|Tags|Assignee|Assignees|Due|Due date|Start|Start date|Task size|Proposed properties):\s*.+$/i;

function isPropertyOnlyContent(text: string): boolean {
  if (!text.trim()) return true;
  const lines = text
    .split(/\s*[\n\r]\s*/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.every((line) => PROPERTY_LINE_REGEX.test(line));
}

const TRAILING_PROPERTY_LINE_MAX_LEN = 400;

function isProposedPropertiesLine(text: string): boolean {
  const match = text.match(PROPERTY_LINE_REGEX);
  return !!match && match[1].toLowerCase() === "proposed properties";
}

function stripPropertyMetadataFromDescription(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  const toRemove: Element[] = [];
  for (const child of Array.from(body.children)) {
    const text = child.textContent?.trim() || "";
    const isSinglePropertyLine =
      text && PROPERTY_LINE_REGEX.test(text) && text.length < 100;
    const isMultiLinePropertyBlock =
      text && text.length < 200 && isPropertyOnlyContent(text);
    if (isSinglePropertyLine || isMultiLinePropertyBlock) {
      toRemove.push(child);
    } else {
      break;
    }
  }
  toRemove.forEach((el) => el.remove());

  const toRemoveFromEnd: Element[] = [];
  for (const child of Array.from(body.children).reverse()) {
    const text = child.textContent?.trim() || "";
    const isProposedProperties =
      text &&
      isProposedPropertiesLine(text) &&
      text.length < TRAILING_PROPERTY_LINE_MAX_LEN;
    if (isProposedProperties) {
      toRemoveFromEnd.push(child);
    } else {
      break;
    }
  }
  toRemoveFromEnd.forEach((el) => el.remove());

  return body.innerHTML;
}

export function extractTaskProperties(
  htmlString: string,
  projectLabels?: ILabel[],
  projectSections?: ISectionLike[],
  projectAssignees?: (IUser | IAgent)[],
): IExtractedTaskProperties {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  const titleEl = doc.getElementById("ai-generated-task-title");
  const rawTitle = titleEl?.textContent?.trim() || null;
  const title = isDuplicateNoteTitle(rawTitle) ? null : rawTitle;
  titleEl?.remove();

  const integerMarker = (id: string) => {
    const element = doc.getElementById(id);
    const value = element?.textContent?.trim() ?? "";
    element?.remove();
    return /^\d+$/.test(value) ? Number(value) : undefined;
  };
  const priorityIndex = integerMarker("ai-generated-task-priority");
  const estimateIndex = integerMarker("ai-generated-task-estimate");

  const tagsEl = doc.getElementById("ai-generated-task-tags");
  const tagIds = tagsEl?.textContent
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  tagsEl?.remove();

  const sectionId = integerMarker("ai-generated-task-status");

  const assigneesEl = doc.getElementById("ai-generated-task-assignees");
  const assigneeIds = assigneesEl?.textContent
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  assigneesEl?.remove();

  const dateFromMarker = (id: string) => {
    const element = doc.getElementById(id);
    const value = element?.textContent?.trim() ?? "";
    element?.remove();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ||
      date.getFullYear() !== Number(value.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(value.slice(5, 7)) ||
      date.getDate() !== Number(value.slice(8, 10))
      ? undefined
      : date;
  };
  const dueDate = dateFromMarker("ai-generated-task-due-date");
  const startDate = dateFromMarker("ai-generated-task-start-date");

  doc.getElementById("ai-generated-task-properties")?.remove();
  let description = doc.body.innerHTML;
  description = stripPropertyMetadataFromDescription(description);

  const status =
    sectionId !== undefined &&
    !Number.isNaN(sectionId) &&
    projectSections?.length
      ? (() => {
          const section = projectSections.find(
            (s) => s.id === sectionId || Number(s.id) === sectionId,
          );
          return section
            ? {
                sectionId: section.id!,
                sectionTitle: section.section_title ?? "",
                position: "top" as const,
              }
            : undefined;
        })()
      : undefined;

  const priority =
    priorityIndex !== undefined && !Number.isNaN(priorityIndex)
      ? PriorityConstants.find((p) => p.priority_index === priorityIndex)
      : undefined;

  const estimate =
    estimateIndex !== undefined && !Number.isNaN(estimateIndex)
      ? EstimateConstants.find((e) => e.estimate_index === estimateIndex)
      : undefined;

  const tags =
    tagIds?.length && projectLabels?.length
      ? tagIds
          .map((id) => projectLabels.find((l) => String(l.id) === id))
          .filter((l): l is ILabel => !!l)
      : undefined;

  const assignees =
    assigneeIds?.length && projectAssignees?.length
      ? assigneeIds
          .map((id) =>
            projectAssignees.find((assignee) => String(assignee.id) === id),
          )
          .filter((assignee): assignee is IUser | IAgent => !!assignee)
      : undefined;

  return {
    title,
    description,
    priority,
    estimate,
    tags: tags && tags.length > 0 ? tags : undefined,
    status,
    assignees: assignees && assignees.length > 0 ? assignees : undefined,
    dueDate,
    startDate,
  };
}
