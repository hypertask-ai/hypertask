import {
  EstimateConstants,
  IEstimateConstants,
  IPrioritiesConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import { ILabel } from "@/models/model";
import type { TSectionPayload } from "@/models/CreateTaskModalModels/model";

export interface IExtractedTaskProperties {
  title: string | null;
  description: string;
  priority?: IPrioritiesConstants;
  estimate?: IEstimateConstants;
  tags?: ILabel[];
  status?: TSectionPayload;
}

/**
 * Extracts task title and description from AI-generated HTML.
 * The AI outputs title in h1#ai-generated-task-title.
 */
export function extractTitleAndDescription(htmlString: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const h1Element = doc.getElementById("ai-generated-task-title");
  const title = h1Element?.textContent?.trim() || null;
  h1Element?.remove();
  const description = doc.body.innerHTML;
  return { title, description };
}

/** Section-like shape for lookup */
interface ISectionLike {
  id?: number;
  section_title?: string;
}

const PROPERTY_LINE_REGEX =
  /^(Priority|Size|Status|Tags|Assignee|Assignees|Task size|Proposed properties):\s*.+$/i;

function isPropertyOnlyContent(text: string): boolean {
  if (!text.trim()) return true;
  const lines = text.split(/\s*[\n\r]\s*/).map((l) => l.trim()).filter(Boolean);
  return lines.every((line) => PROPERTY_LINE_REGEX.test(line));
}

// Combined trailing line ("Proposed properties: Priority High, Size S, ...")
// can list several properties, so it needs more headroom than a single
// old-style "Priority: High" line.
const TRAILING_PROPERTY_LINE_MAX_LEN = 400;

// The trailing paragraph is only ever the new combined marker, never a bare
// "Priority: ..." line (that shape is leading-only chrome). Scoping trailing
// removal to specifically "Proposed properties" - rather than the full
// keyword alternation above - keeps a real sentence like "Priority: whatever
// the reporter says." at the end of a description intact.
function isProposedPropertiesLine(text: string): boolean {
  const match = text.match(PROPERTY_LINE_REGEX);
  return !!match && match[1].toLowerCase() === "proposed properties";
}

/**
 * Strips human-readable property metadata (Priority, Size, Status, Tags, etc.)
 * from the HTML when those properties have been extracted. The AI may output
 * both hidden spans and visible text; we remove the visible metadata so it
 * doesn't duplicate the sidebar.
 *
 * Current output (HTPR-5606) puts one combined "Proposed properties: ..."
 * paragraph as the LAST element; older output printed one property per line
 * at the start. Both are stripped, walking in from each end and stopping at
 * the first node with real content.
 */
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

/**
 * Extracts task properties (title, description, priority, size, tags, status) from AI-generated HTML.
 * Used for "Accept ALL" in Task Writer. Properties are optional - AI may omit them.
 *
 * Backend output format (when aiMode === "AiTaskWriter"):
 * - h1#ai-generated-task-title: task title
 * - span#ai-generated-task-priority: priority_index (0-4)
 * - span#ai-generated-task-estimate: estimate_index (0-7)
 * - span#ai-generated-task-tags: comma-separated label IDs
 * - span#ai-generated-task-status: section_id (number)
 */
export function extractTaskProperties(
  htmlString: string,
  projectLabels?: ILabel[],
  projectSections?: ISectionLike[]
): IExtractedTaskProperties {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  const titleEl = doc.getElementById("ai-generated-task-title");
  const title = titleEl?.textContent?.trim() || null;
  titleEl?.remove();

  const priorityEl = doc.getElementById("ai-generated-task-priority");
  const priorityIndex = priorityEl
    ? parseInt(priorityEl.textContent?.trim() ?? "", 10)
    : undefined;
  priorityEl?.remove();

  const estimateEl = doc.getElementById("ai-generated-task-estimate");
  const estimateIndex = estimateEl
    ? parseInt(estimateEl.textContent?.trim() ?? "", 10)
    : undefined;
  estimateEl?.remove();

  const tagsEl = doc.getElementById("ai-generated-task-tags");
  const tagIds = tagsEl?.textContent
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  tagsEl?.remove();

  const statusEl = doc.getElementById("ai-generated-task-status");
  const sectionId = statusEl
    ? parseInt(statusEl.textContent?.trim() ?? "", 10)
    : undefined;
  statusEl?.remove();

  let description = doc.body.innerHTML;
  description = stripPropertyMetadataFromDescription(description);

  const status =
    sectionId !== undefined &&
    !Number.isNaN(sectionId) &&
    projectSections?.length
      ? (() => {
          const section = projectSections.find(
            (s) => s.id === sectionId || Number(s.id) === sectionId
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

  return {
    title,
    description,
    priority,
    estimate,
    tags: tags && tags.length > 0 ? tags : undefined,
    status,
  };
}
  