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

/**
 * Maps a row of the @ suggestion list to the attributes of the mention node the
 * editor inserts. Extracted from MentionList so the mapping is checkable: a
 * wrong `id`/`label` pair makes buildRichTextMentionHref return null and the
 * chip degrades to unlinked text without anything throwing.
 */
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
      projectId: item?.id as number,
      label: `project-${item?.id}`,
    };
  }

  if (item?.type === "agent") {
    return { id: `${item?.name}`, label: `agent-${item?.id}` };
  }

  // HTPR-5898: `id` carries the page publicId, because that is what
  // buildRichTextMentionHref turns into /page/<id>. The chip renders `text`,
  // so readers see the page title instead of the id.
  if (item?.type === "page") {
    return { id: String(item?.id ?? ""), label: "page", text: item?.name };
  }

  return { id: item?.name as string, label: `${item?.type}-${item?.id}` };
}
