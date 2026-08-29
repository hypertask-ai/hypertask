import { parse } from "node-html-parser";

import {
  EstimateConstants,
  PriorityConstants,
} from "@/lib/constants/constants";

/**
 * Server-side twin of the "Accept ALL" extraction the task detail does in
 * src/utils/aiWriterUtils.ts. Non-browser callers (the CLI, MCP tools) get the
 * same split the UI performs when you accept a response: the title, priority
 * and size come out as fields, and the description keeps only the prose.
 *
 * Label and section markers are deliberately ignored. The prompt never tells
 * the model which label or section IDs exist, so anything it emits there is
 * invented; the UI drops them for the same reason.
 */
export type TaskWriterProperties = {
  title: string | null;
  description: string;
  priority?: number;
  estimate?: number;
};

const PROPERTY_LINE_RE =
  /^(Priority|Size|Status|Tags|Assignee|Assignees|Task size|Proposed properties):\s*.+$/i;

// Combined trailing line ("Proposed properties: Priority High, Size S, ...")
// can list several properties, so it needs more headroom than a single
// old-style "Priority: High" line.
const TRAILING_PROPERTY_LINE_MAX_LEN = 400;

function isPropertyOnlyContent(text: string) {
  if (!text.trim()) return true;
  return text
    .split(/\s*[\n\r]\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => PROPERTY_LINE_RE.test(line));
}

// The trailing paragraph is only ever the new combined marker, never a bare
// "Priority: ..." line (that shape is leading-only chrome). Scoping trailing
// removal to specifically "Proposed properties" - rather than the full
// keyword alternation above - keeps a real sentence like "Priority: whatever
// the reporter says." at the end of a description intact.
function isProposedPropertiesLine(text: string): boolean {
  const match = text.match(PROPERTY_LINE_RE);
  return !!match && match[1].toLowerCase() === "proposed properties";
}

/**
 * Read a marker span as an index, then drop the marker.
 *
 * `allowed` mirrors what the browser extractor does with PriorityConstants /
 * EstimateConstants: an index outside the real set becomes undefined rather
 * than a value the caller would try (and fail) to write to the task.
 */
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

export function extractTaskWriterProperties(html: string): TaskWriterProperties {
  const parsed = parse(html);
  // A model that wraps its answer in a full document would otherwise leave the
  // <html>/<body> shell in the description and hide the property lines from the
  // leading-child scan below. The browser extractor reads document.body.
  const root = parsed.querySelector("body") ?? parsed;

  const titleEl = root.querySelector("#ai-generated-task-title");
  const title = titleEl?.textContent.trim() || null;
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

  // The model prints a human-readable "Priority: High" line next to each hidden
  // span. Once the value is a field, that line is duplicate chrome.
  for (const child of [...root.childNodes]) {
    const text = child.textContent?.trim() ?? "";
    const isSingleLine = text && PROPERTY_LINE_RE.test(text) && text.length < 100;
    const isBlock = text && text.length < 200 && isPropertyOnlyContent(text);
    if (isSingleLine || isBlock) child.remove();
    else if (text) break;
  }

  // HTPR-5606: properties now arrive as one combined "Proposed properties:
  // ..." paragraph at the END of the output instead of one line per property
  // at the start. Walk in from the end and remove only that marker,
  // stopping at the first node with real content.
  for (const child of [...root.childNodes].reverse()) {
    const text = child.textContent?.trim() ?? "";
    const isProposedProperties =
      text && isProposedPropertiesLine(text) && text.length < TRAILING_PROPERTY_LINE_MAX_LEN;
    if (isProposedProperties) child.remove();
    else if (text) break;
  }

  // innerHTML, not toString: when the model wrapped its answer in a document we
  // unwrapped to <body>, and toString would put that tag back in the description.
  return { title, description: root.innerHTML.trim(), priority, estimate };
}
