export interface MentionSuggestionItem {
  type?: string;
  id?: string | number;
  name?: string;
  index?: number;
  project_id?: number;
  ticketNumber?: string;
  identifier?: string;
}

export interface MentionNodeAttrs {
  id: string;
  label: string;
  projectId?: number;
  uniqueIndex?: number;
  text?: string;
}

export function mentionAttrsForItem(
  item: MentionSuggestionItem,
): MentionNodeAttrs {
  if (item?.type === "task") {
    return {
      projectId: item?.project_id,
      uniqueIndex: item?.index,
      id: `${item?.ticketNumber} ${item?.name}`,
      label: "task",
    };
  }

  if (item?.type === "project") {
    return {
      id: `${item?.identifier} ${item?.name}`,
      projectId: Number(item?.id),
      label: `project-${item?.id}`,
    };
  }

  if (item?.type === "agent") {
    return { id: `${item?.name}`, label: `agent-${item?.id}` };
  }

  if (item?.type === "page") {
    return { id: String(item?.id ?? ""), label: "page", text: item?.name };
  }

  return { id: String(item?.name ?? ""), label: `${item?.type}-${item?.id}` };
}
