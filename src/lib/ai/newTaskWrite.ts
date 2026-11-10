import { taskWriterRoute } from "@/lib/constants/APIRouteConstants";
import {
  EstimateConstants,
  PriorityConstants,
} from "@/lib/constants/constants";
import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import type { TaskTemplateSummary } from "@/lib/taskTemplatePrefill";
import type { ILabel, IProject } from "@/models/model";
import type { IExtractedTaskProperties } from "@/utils/aiWriterUtils";
import {
  describeTaskWriterFailure,
  describeTaskWriterStreamFailure,
} from "@/utils/helperFunctions/describeTaskWriterFailure";
import { buildTaskWriterRequestScope } from "./taskWriterBoardContext";

const MAX_TEMPLATE_CHIPS = 8;
const MAX_TEMPLATE_TEXT_LENGTH = 2_000;

export function isNewTaskCtrlJ(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
  > & { isComposing?: boolean },
  isApple: boolean,
) {
  return (
    event.code === "KeyJ" &&
    !event.isComposing &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || (isApple && event.metaKey))
  );
}

export interface NewTaskWriteChip {
  key: string;
  label: string;
  hint: string;
  template?: TaskTemplateSummary;
}

export interface NewTaskWriteOutcome {
  description: string;
  applyProperties: () => void;
}

export interface NewTaskWriter {
  chips: NewTaskWriteChip[];
  write: (
    instruction: string,
    chip: NewTaskWriteChip | null,
  ) => Promise<NewTaskWriteOutcome>;
}

export const FALLBACK_NEW_TASK_WRITE_CHIPS: NewTaskWriteChip[] = [
  {
    key: "fallback-bug-report",
    label: "Bug report",
    hint: "Write this as a bug report: what happens, steps to reproduce, the expected result and the actual result.",
  },
  {
    key: "fallback-feature",
    label: "Feature",
    hint: "Write this as a feature request: the problem it solves, what the user can do afterwards and what is out of scope.",
  },
  {
    key: "fallback-acceptance-criteria",
    label: "Acceptance criteria",
    hint: "Write this task with a short summary and a checklist of acceptance criteria that can each be checked as done or not done.",
  },
];

export function plainTextFromHtml(html: string) {
  return html
    .replace(/<\/(?:p|li|h[1-6]|div|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function templateHint(template: TaskTemplateSummary) {
  const lines = [
    `Use the board's "${template.name}" task template. Keep its structure and fill it in from the note.`,
  ];
  const title = template.title.trim();
  if (title) lines.push(`Template title: ${title}`);
  const description = plainTextFromHtml(template.descriptionHtml).slice(
    0,
    MAX_TEMPLATE_TEXT_LENGTH,
  );
  if (description) lines.push(`Template description:\n${description}`);
  return lines.join("\n");
}

export function buildNewTaskWriteChips(
  templates: TaskTemplateSummary[] | undefined,
): NewTaskWriteChip[] {
  if (!templates?.length) return FALLBACK_NEW_TASK_WRITE_CHIPS;
  return templates.slice(0, MAX_TEMPLATE_CHIPS).map((template) => ({
    key: `template-${template.id}`,
    label: template.name,
    hint: templateHint(template),
    template,
  }));
}

export function buildNewTaskWritePrompt(
  instruction: string,
  chip: NewTaskWriteChip | null,
  currentTitle: string,
) {
  const parts = [
    "Write a task title and description in the board's style from the note below.",
  ];
  if (chip) parts.push(chip.hint);
  if (currentTitle.trim()) {
    parts.push(`The task title is already "${currentTitle.trim()}". Keep it.`);
  }
  parts.push(`Note:\n${instruction.trim()}`);
  return parts.join("\n\n");
}

export function shapeNewTaskWriteResult(
  result: IExtractedTaskProperties,
  chip: NewTaskWriteChip | null,
  projectLabels: ILabel[] | undefined,
): IExtractedTaskProperties {
  const template = chip?.template;
  if (!template) return result;
  const templateLabelIds = new Set(template.labelIds.map(String));
  const templateTags = (projectLabels ?? []).filter((label) =>
    templateLabelIds.has(String(label.id)),
  );
  return {
    ...result,
    priority:
      PriorityConstants.find(
        (priority) => priority.priority_index === template.priorityIndex,
      ) ?? result.priority,
    estimate:
      EstimateConstants.find(
        (estimate) => estimate.estimate_index === template.estimateIndex,
      ) ?? result.estimate,
    tags: templateTags.length ? templateTags : result.tags,
  };
}

export async function requestNewTaskWrite({
  project,
  instruction,
  chip,
  currentTitle,
}: {
  project: IProject;
  instruction: string;
  chip: NewTaskWriteChip | null;
  currentTitle: string;
}): Promise<string> {
  const boardAi = project.ai_custom_instructions?.[0];
  const response = await fetch(taskWriterRoute, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...buildTaskWriterRequestScope(project, deriveCurrentBoardBilling(project)),
      PROMPT: buildNewTaskWritePrompt(instruction, chip, currentTitle),
      userRetrievalTexts: [instruction],
      customInstructions: boardAi?.customInstruction ?? "",
      sourceSelected: boardAi?.source_selected ?? "openai",
      modelSelected: boardAi?.model_selected ?? undefined,
      aiMode: "AiTaskWriter",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      images64: [],
      taskDescription: "",
    }),
  });
  if (!response.ok) throw new Error(await describeTaskWriterFailure(response));
  const html = await response.text();
  const failure = describeTaskWriterStreamFailure(html);
  if (failure) throw new Error(failure);
  return html;
}
