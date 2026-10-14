import { parse } from "node-html-parser";

import {
  EstimateConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import {
  isDuplicateNoteTitle,
  repairDuplicateNote,
} from "@/lib/ai/taskWriterDuplicateGuard";

export type TaskWriterProperties = {
  title: string | null;
  description: string;
  priority?: number;
  estimate?: number;
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

const PRIORITY_INDEXES = new Set(
  PriorityConstants.map((entry) => entry.priority_index)
);
const ESTIMATE_INDEXES = new Set(
  EstimateConstants.map((entry) => entry.estimate_index)
);

export function extractTaskWriterProperties(
  html: string,
  options: { fallbackTitle?: string | null } = {}
): TaskWriterProperties {
  const parsed = parse(repairDuplicateNote(html, options.fallbackTitle));
  const root = parsed.querySelector("body") ?? parsed;

  const titleEl = root.querySelector("#ai-generated-task-title");
  const rawTitle = titleEl?.textContent.trim() || null;
  const title = isDuplicateNoteTitle(rawTitle) ? null : rawTitle;
  titleEl?.remove();

  const priority = indexFromMarker(
    root,
    "ai-generated-task-priority",
    PRIORITY_INDEXES
  );
  const estimate = indexFromMarker(
    root,
    "ai-generated-task-estimate",
    ESTIMATE_INDEXES
  );
  root.querySelector("#ai-generated-task-tags")?.remove();
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

  return { title, description: root.innerHTML.trim(), priority, estimate };
}
