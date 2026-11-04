
export interface ResolvableMember {
  id: number | string;
  displayName: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });

const MENTION_SPAN =
  /<span\b[^>]*\bdata-type=["']mention["'][^>]*>[\s\S]*?<\/span>/gi;
const SPAN_CLOSE = "</span>";

function labelFor(member: ResolvableMember): string {
  return typeof member.id === "number"
    ? `name-${member.id}`
    : `agent-${member.id}`;
}

function spanFor(member: ResolvableMember): string {
  const escapedDisplayName = escapeHtml(member.displayName);
  const escapedLabel = escapeHtml(labelFor(member));
  return `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="${escapedLabel}" uniqueindex="" projectid="">${escapedDisplayName}</span>`;
}

function attributePattern(name: string): RegExp {
  return new RegExp(`(\\b${name}=)(["'])([\\s\\S]*?)\\2`, "i");
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = attributePattern(name).exec(tag);
  return match ? match[3] : undefined;
}

function writeAttribute(tag: string, name: string, value: string): string {
  const pattern = attributePattern(name);
  if (pattern.test(tag)) {
    return tag.replace(pattern, (_whole, prefix, quote) => `${prefix}${quote}${value}${quote}`);
  }
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

function memberByName(
  name: string,
  members: ResolvableMember[],
): ResolvableMember | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  const hits = members.filter(
    (member) => member.displayName.trim().toLowerCase() === wanted,
  );
  return hits.length === 1 ? hits[0] : undefined;
}

function memberByLabel(
  label: string,
  members: ResolvableMember[],
): ResolvableMember | undefined {
  const wanted = label.trim();
  if (!wanted) return undefined;
  return members.find((member) => labelFor(member) === wanted);
}

function memberFor(
  name: string,
  label: string,
  members: ResolvableMember[],
): ResolvableMember | undefined {
  return memberByLabel(label, members) ?? memberByName(name, members);
}

function mapOutsideMentionSpans(
  html: string,
  transform: (segment: string) => string,
): string {
  let result = "";
  let cursor = 0;
  for (const match of html.matchAll(MENTION_SPAN)) {
    const start = match.index ?? 0;
    result += transform(html.slice(cursor, start)) + match[0];
    cursor = start + match[0].length;
  }
  return result + transform(html.slice(cursor));
}

export function normalizeMentionSpans(
  html: string,
  members: ResolvableMember[],
): string {
  if (!html || !members?.length) return html;
  if (!/data-type=["']mention["']/i.test(html)) return html;

  return html.replace(MENTION_SPAN, (whole) => {
    const openEnd = whole.indexOf(">") + 1;
    const tag = whole.slice(0, openEnd);
    const member = memberFor(
      readAttribute(tag, "data-id") ?? "",
      readAttribute(tag, "data-label") ?? "",
      members,
    );
    if (!member) return whole;

    const normalizedTag = writeAttribute(
      writeAttribute(tag, "data-id", escapeHtml(member.displayName)),
      "data-label",
      escapeHtml(labelFor(member)),
    );
    return `${normalizedTag}${escapeHtml(member.displayName)}${SPAN_CLOSE}`;
  });
}

export function injectMentionSpans(
  text: string,
  members: ResolvableMember[],
): string {
  if (!text || !members?.length) return text;
  const sorted = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );

  const injectInto = (segment: string) => {
    let result = segment;

    for (const m of sorted) {
      const span = spanFor(m);
      result = result.replace(
        new RegExp(`(?<!\\w)@${escapeRegExp(String(m.id))}\\b`, "g"),
        span,
      );
      if (m.displayName) {
        result = result.replace(
          new RegExp(`(?<!\\w)@${escapeRegExp(m.displayName)}\\b`, "gi"),
          span,
        );
      }
    }

    return result.replace(/(?<!\w)@(\p{L}[\p{L}\p{N}'’\-]*)/gu, (whole, token) => {
      const t = token.toLowerCase();
      if (t.length < 2) return whole;
      const hits = sorted.filter(
        (m) => m.displayName && m.displayName.toLowerCase().startsWith(t),
      );
      return hits.length === 1 ? spanFor(hits[0]) : whole;
    });
  };

  return /data-type=["']mention["']/i.test(text)
    ? mapOutsideMentionSpans(text, injectInto)
    : injectInto(text);
}

export interface MentionProblem {
  input: string;
  reason: "unknown" | "ambiguous";
  closeMatches: string[];
}

export interface ResolvedMention {
  userId: number;
  displayName: string;
}

const CLOSE_MATCH_LIMIT = 3;
const CLOSE_PREFIX_LENGTH = 4;

function sharesNamePrefix(a: string, b: string): boolean {
  const width = Math.min(a.length, b.length, CLOSE_PREFIX_LENGTH);
  return width > 0 && a.slice(0, width) === b.slice(0, width);
}

export function closeMentionMatches(
  input: string,
  members: ResolvableMember[],
): string[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return [];
  const scored = members
    .filter((member) => member.displayName)
    .map((member) => {
      const name = member.displayName;
      const lower = name.toLowerCase();
      let score = 0;
      if (lower.startsWith(needle)) score = 3;
      else if (lower.includes(needle) || needle.includes(lower)) score = 2;
      else if (sharesNamePrefix(needle, lower)) score = 1;
      return { name, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  return [...new Set(scored.map((candidate) => candidate.name))].slice(
    0,
    CLOSE_MATCH_LIMIT,
  );
}

export type ResolvedMentionTarget =
  | { user_id: number; display_name: string }
  | { agent_id: string; display_name: string };

function toMentionTarget(member: ResolvableMember): ResolvedMentionTarget {
  return typeof member.id === "number"
    ? { user_id: member.id, display_name: member.displayName }
    : { agent_id: String(member.id), display_name: member.displayName };
}

function matchMentionName(
  input: string,
  candidates: ResolvableMember[],
): { match?: ResolvableMember; problem?: MentionProblem } {
  const exactMatches = candidates.filter(
    (member) => member.displayName.toLowerCase() === input.toLowerCase(),
  );

  if (exactMatches.length === 1) return { match: exactMatches[0] };
  if (exactMatches.length > 1) {
    return {
      problem: {
        input,
        reason: "ambiguous",
        closeMatches: exactMatches
          .slice(0, CLOSE_MATCH_LIMIT)
          .map((member) => member.displayName),
      },
    };
  }

  const prefixMatches = candidates.filter((member) =>
    member.displayName.toLowerCase().startsWith(input.toLowerCase()),
  );

  if (prefixMatches.length === 1) return { match: prefixMatches[0] };
  if (prefixMatches.length > 1) {
    return {
      problem: {
        input,
        reason: "ambiguous",
        closeMatches: prefixMatches
          .slice(0, CLOSE_MATCH_LIMIT)
          .map((member) => member.displayName),
      },
    };
  }

  return {};
}

export function resolveMentionTargets(
  entries: string[],
  members: ResolvableMember[],
): { resolved: ResolvedMentionTarget[]; problems: MentionProblem[] } {
  const resolved: ResolvedMentionTarget[] = [];
  const problems: MentionProblem[] = [];
  const people = members.filter(
    (member) => typeof member.id === "number" && member.displayName,
  );
  const agents = members.filter(
    (member) => typeof member.id === "string" && member.displayName,
  );

  for (const raw of entries) {
    const input = String(raw ?? "").trim().replace(/^@+/, "").trim();
    if (!input) {
      problems.push({ input: String(raw ?? ""), reason: "unknown", closeMatches: [] });
      continue;
    }

    if (/^\d+$/.test(input)) {
      const byId = people.find((member) => Number(member.id) === Number(input));
      if (byId) {
        resolved.push(toMentionTarget(byId));
        continue;
      }
    }

    const person = matchMentionName(input, people);
    if (person.match) {
      resolved.push(toMentionTarget(person.match));
      continue;
    }
    if (person.problem) {
      problems.push(person.problem);
      continue;
    }

    const agent = matchMentionName(input, agents);
    if (agent.match) {
      resolved.push(toMentionTarget(agent.match));
      continue;
    }
    if (agent.problem) {
      problems.push(agent.problem);
      continue;
    }

    problems.push({
      input,
      reason: "unknown",
      closeMatches: closeMentionMatches(input, [...people, ...agents]),
    });
  }

  return { resolved, problems };
}

export function resolveMentionEntries(
  entries: string[],
  members: ResolvableMember[],
): { resolved: ResolvedMention[]; problems: MentionProblem[] } {
  const people = members.filter(
    (member) => typeof member.id === "number" && member.displayName,
  );
  const { resolved, problems } = resolveMentionTargets(entries, people);

  return {
    resolved: resolved.filter(
      (mention): mention is { user_id: number; display_name: string } => "user_id" in mention,
    ).map((mention) => ({ userId: mention.user_id, displayName: mention.display_name })),
    problems,
  };
}
