export const MAX_SKILL_BODY_BYTES = 64 * 1024;

export type ParsedSkillMarkdown = {
  name: string;
  description: string | null;
  argumentHint: string | null;
  body: string;
  slug: string;
};

export function slugifySkill(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseSkillMarkdown(
  markdown: string,
  fallbackName?: string
): ParsedSkillMarkdown {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let frontmatter = "";
  let body = normalized;

  if (normalized.startsWith("---\n")) {
    const closing = normalized.indexOf("\n---", 4);
    if (closing === -1) throw new Error("SKILL.md frontmatter is not closed");
    frontmatter = normalized.slice(4, closing);
    body = normalized.slice(closing + 4).replace(/^\n/, "");
  }

  const fields = parseFlatFrontmatter(frontmatter);
  const name = fields.name?.trim() || fallbackName?.trim() || "";
  const slug = slugifySkill(name);
  const trimmedBody = body.trim();

  if (!name) throw new Error("Skill name is required");
  if (!slug) throw new Error("Skill name must contain a letter or number");
  if (!trimmedBody) throw new Error(`Skill "${name}" has an empty body`);
  if (Buffer.byteLength(trimmedBody, "utf8") > MAX_SKILL_BODY_BYTES) {
    throw new Error(`Skill "${name}" exceeds the 64KB body limit`);
  }

  return {
    name,
    description: fields.description?.trim() || null,
    argumentHint: fields["argument-hint"]?.trim() || null,
    body: trimmedBody,
    slug,
  };
}

function parseFlatFrontmatter(value: string) {
  const fields: Record<string, string> = {};
  for (const line of value.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    fields[match[1].toLowerCase()] = parseYamlScalar(match[2]);
  }
  return fields;
}

function parseYamlScalar(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : inner.replace(/''/g, "'");
  }
  return trimmed;
}
