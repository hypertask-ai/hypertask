import { parse } from "node-html-parser";

import {
  EstimateConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import { enforceBrainLabel, type TaskWriterBrainLabels } from "@/lib/ai/taskWriterBrainLabels";
import {
  isDuplicateNoteTitle,
  repairDuplicateNote,
} from "@/lib/ai/taskWriterDuplicateGuard";

export type TaskWriterProperties = {
  title: string | null;
  description: string;
  priority?: number;
  estimate?: number;
  labelIds?: string[];
};

export const TASK_WRITER_EMPTY_DRAFT_MESSAGE = "Could not write this task, try again";

export function hasUsableTaskWriterDraft(html: string) {
  const root = parse(html);
  return Boolean(root.textContent.trim() || root.querySelector("img, video, audio, iframe, embed"));
}

const PROPERTY_LINE_RE =
  /^(Priority|Size|Status|Tags|Assignee|Assignees|Task size|Proposed properties):\s*.+$/i;

const TRAILING_PROPERTY_LINE_MAX_LEN = 400;

function isPropertyOnlyContent(text: string) {
  if (!text.trim()) return true;
  return text
    .split(/\s*[\n\r]\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => PROPERTY_LINE_RE.test(line));
}

function isProposedPropertiesLine(text: string): boolean {
  const match = text.match(PROPERTY_LINE_RE);
  return !!match && match[1].toLowerCase() === "proposed properties";
}

function indexFromMarker(
  root: ReturnType<typeof parse>,
  id: string,
  allowed: Set<number>
) {
  const el = root.querySelector(`#${id}`);
  if (!el) return undefined;
  const value = parseInt(el.textContent.trim(), 10);
  el.remove();
  return allowed.has(value) ? value : undefined;
}

export const TASK_WRITER_URGENT_PRIORITY_INDEX = 1;

const PRIORITY_INDEXES = new Set(
  PriorityConstants.map((entry) => entry.priority_index)
);
const ESTIMATE_INDEXES = new Set(
  EstimateConstants.map((entry) => entry.estimate_index)
);

export function validateTaskWriterLabelIds(value: unknown, boardLabelIds: string[]): string[] {
  const allowed = new Set(boardLabelIds);
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && allowed.has(id)))] : [];
}

export function finalizeTaskWriterLabelIds(value: unknown, boardLabelIds: string[], brain?: TaskWriterBrainLabels | null): string[] {
  return enforceBrainLabel(validateTaskWriterLabelIds(value, boardLabelIds), brain);
}

export function normalizeTaskWriterLabels(html: string, boardLabelIds: string[], brain?: TaskWriterBrainLabels | null): string {
  const root = parse(html);
  const markers = root.querySelectorAll("#ai-generated-task-tags");
  for (const marker of markers) {
    marker.set_content(finalizeTaskWriterLabelIds(marker.textContent.split(",").map((id) => id.trim()), boardLabelIds, brain).join(","));
  }
  const defaultId = brain?.defaultId;
  if (!markers.length && defaultId) {
    root.insertAdjacentHTML("beforeend", `<span id="ai-generated-task-tags" style="display:none">${defaultId}</span>`);
  }
  return root.toString();
}

export function forceUrgentPriorityMarker(html: string): string {
  const root = parse(html);
  const markers = root.querySelectorAll("#ai-generated-task-priority");
  for (const marker of markers) marker.set_content(String(TASK_WRITER_URGENT_PRIORITY_INDEX));
  if (!markers.length) {
    const siblingMarker = root.querySelector("#ai-generated-task-estimate, #ai-generated-task-tags, #ai-generated-task-status");
    const priorityMarker = `<span id="ai-generated-task-priority" style="display:none">${TASK_WRITER_URGENT_PRIORITY_INDEX}</span>`;
    if (siblingMarker) siblingMarker.insertAdjacentHTML("beforebegin", priorityMarker);
    else root.insertAdjacentHTML("beforeend", priorityMarker);
  }
  return root.toString();
}

export function extractTaskWriterProperties(
  html: string,
  options: { fallbackTitle?: string | null; boardLabelIds?: string[]; brainLabels?: TaskWriterBrainLabels | null; forceUrgent?: boolean } = {}
): TaskWriterProperties {
  const parsed = parse(repairDuplicateNote(html, options.fallbackTitle));
  const root = parsed.querySelector("body") ?? parsed;

  const titleEl = root.querySelector("#ai-generated-task-title");
  const rawTitle = titleEl?.textContent.trim() || null;
  const title = isDuplicateNoteTitle(rawTitle) ? null : rawTitle;
  titleEl?.remove();

  const modelPriority = indexFromMarker(
    root,
    "ai-generated-task-priority",
    PRIORITY_INDEXES
  );
  const priority = options.forceUrgent ? TASK_WRITER_URGENT_PRIORITY_INDEX : modelPriority;
  const estimate = indexFromMarker(
    root,
    "ai-generated-task-estimate",
    ESTIMATE_INDEXES
  );
  const tags = root.querySelector("#ai-generated-task-tags");
  const labelIds = options.boardLabelIds
    ? finalizeTaskWriterLabelIds(tags?.textContent.split(",").map((id) => id.trim()), options.boardLabelIds, options.brainLabels)
    : undefined;
  tags?.remove();
  root.querySelector("#ai-generated-task-status")?.remove();
  root.querySelector("#ai-generated-task-properties")?.remove();

  for (const child of [...root.childNodes]) {
    const text = child.textContent?.trim() ?? "";
    const isSingleLine = text && PROPERTY_LINE_RE.test(text) && text.length < 100;
    const isBlock = text && text.length < 200 && isPropertyOnlyContent(text);
    if (isSingleLine || isBlock) child.remove();
    else if (text) break;
  }

  for (const child of [...root.childNodes].reverse()) {
    const text = child.textContent?.trim() ?? "";
    const isProposedProperties =
      text && isProposedPropertiesLine(text) && text.length < TRAILING_PROPERTY_LINE_MAX_LEN;
    if (isProposedProperties) child.remove();
    else if (text) break;
  }

  return { title, description: root.innerHTML.trim(), priority, estimate, ...(labelIds ? { labelIds } : {}) };
}
