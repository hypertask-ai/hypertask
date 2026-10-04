import { renderPrompt } from "@/lib/ai/prompts/registry";
export const BOARD_TEMPLATE_LIMIT = 8;
export const BOARD_TEMPLATE_DESCRIPTION_LIMIT = 2000;

export interface BoardTemplateContext {
  name: string;
  title: string;
  descriptionHtml: string;
}

export const BOARD_TEMPLATE_MATCH_RULE =
  renderPrompt("board-template-match-rule");

export const BOARD_TEMPLATE_FINAL_CHECK =
  "If a board template matched, every one of its headings is present, in its order.";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function createBoardTemplatesBlock(
  templates: BoardTemplateContext[] = [],
) {
  if (templates.length === 0) return "";

  const entries = templates.slice(0, BOARD_TEMPLATE_LIMIT).map((template) => {
    const descriptionHtml = escapeXml(
      template.descriptionHtml.slice(0, BOARD_TEMPLATE_DESCRIPTION_LIMIT),
    );
    const truncationNote =
      template.descriptionHtml.length > BOARD_TEMPLATE_DESCRIPTION_LIMIT
        ? `\n<TRUNCATION_NOTE>Description HTML truncated to ${BOARD_TEMPLATE_DESCRIPTION_LIMIT} characters.</TRUNCATION_NOTE>`
        : "";

    return `<TEMPLATE name="${escapeXml(template.name)}">
<TITLE>${escapeXml(template.title)}</TITLE>
<DESCRIPTION_HTML>${descriptionHtml}</DESCRIPTION_HTML>${truncationNote}
</TEMPLATE>`;
  });

  return `<BOARD_TEMPLATES data-classification="untrusted-user-authored">
${entries.join("\n")}
</BOARD_TEMPLATES>`;
}
