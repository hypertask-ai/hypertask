import {
  EstimateConstants,
  PriorityConstants,
  type IEstimateConstants,
  type IPrioritiesConstants,
} from "@/lib/constants/constants";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";

export interface TaskTemplateSummary {
  id: number;
  name: string;
  title: string;
  descriptionHtml: string;
  priorityIndex: number | null;
  estimateIndex: number | null;
  labelIds: string[];
}

export interface TaskTemplateLabel {
  id: string;
  value: string;
  projectId: number;
}

export interface TaskTemplateTargetSection {
  id: number;
  section_title: string;
}

export interface TaskTemplateSection extends TaskTemplateTargetSection {
  isDone?: boolean | null;
  visibility?: boolean | null;
}

export interface TaskTemplatePrefillContext {
  labels: TaskTemplateLabel[];
  targetSection: TaskTemplateTargetSection | null;
}

export interface TaskTemplatePickerState {
  projectId: number | null;
  templates: TaskTemplateSummary[];
  context: TaskTemplatePrefillContext;
}

export interface TaskTemplateDuplicatePayload {
  title: string;
  description: string;
  priority?: IPrioritiesConstants;
  estimate?: IEstimateConstants;
  taskLabels: Array<{ labelId: string; label: TaskTemplateLabel }>;
  sectionId: number;
  section: string;
}

export type OpenTaskTemplateDraft = (
  duplicate: TaskTemplateDuplicatePayload,
) => void;

export function taskTemplatePickerForProject(
  picker: TaskTemplatePickerState,
  projectId?: number,
): TaskTemplatePickerState {
  if (picker.projectId === projectId) return picker;
  return {
    projectId: null,
    templates: [],
    context: { labels: [], targetSection: null },
  };
}

export function taskTemplateSectionWhere(projectId: number) {
  return { projectId, deleted: false } as const;
}

export function findTaskTemplateTargetSection(
  sections: TaskTemplateSection[],
): TaskTemplateTargetSection | null {
  return sections.find((section) => columnRoleFor(section) !== "done") ?? null;
}

export function buildTemplateDuplicatePayload(
  template: TaskTemplateSummary,
  context: TaskTemplatePrefillContext,
): TaskTemplateDuplicatePayload | null {
  if (!context.targetSection) return null;

  const liveLabelsById = new Map(
    context.labels.map((label) => [label.id, label]),
  );
  const taskLabels = template.labelIds.flatMap((labelId) => {
    const label = liveLabelsById.get(labelId);
    return label ? [{ labelId, label }] : [];
  });

  return {
    title: template.title,
    description: template.descriptionHtml,
    priority:
      PriorityConstants.find(
        (priority) => priority.priority_index === template.priorityIndex,
      ) ?? undefined,
    estimate:
      EstimateConstants.find(
        (estimate) => estimate.estimate_index === template.estimateIndex,
      ) ?? undefined,
    taskLabels,
    sectionId: context.targetSection.id,
    section: context.targetSection.section_title,
  };
}

export function openTaskTemplateDraft(
  templateId: unknown,
  templates: TaskTemplateSummary[],
  context: TaskTemplatePrefillContext,
  openDraft: OpenTaskTemplateDraft,
): boolean {
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template) return false;

  const duplicate = buildTemplateDuplicatePayload(template, context);
  if (!duplicate) return false;

  openDraft(duplicate);
  return true;
}
