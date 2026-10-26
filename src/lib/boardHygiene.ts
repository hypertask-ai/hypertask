import { z } from "zod";

const acronyms = new Set(["PR", "CI", "UI", "API", "HT", "AI", "CLI", "MCP", "QA", "UX", "SDK", "URL", "JSON", "CSS", "HTML", "SQL", "JS", "TS"]);
const smallWords = new Set(["of", "and", "the"]);

export function titleCaseLabel(value: string): string {
  return value.trim().split(/\s+/u).map((word, index) => {
    if (acronyms.has(word.toUpperCase())) return word.toUpperCase();
    const lower = word.toLowerCase();
    if (index > 0 && smallWords.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

export function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/gu, "").replace(/s$/u, "");
}

function nearMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 2) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    if (Math.min(...current) > 2) return false;
    previous = current;
  }
  return previous[right.length] <= 2;
}

const labelFilter = z.array(z.object({
  type: z.literal("Labels"),
  searchPayload: z.array(z.object({ id: z.string() })).length(1),
})).length(1);

type HygieneLabel = { id: string; value: string | null; createdAt: Date; taskCount: number };

export function boardHygieneReport(input: {
  untaggedOpenTickets: number;
  labels: HygieneLabel[];
  publicViewFilters: unknown[];
  columns: { id: number; title: string; openTickets: number; staleTickets: number; wipLimit: number | null }[];
}) {
  const labels = [...input.labels].sort((a, b) => b.taskCount - a.taskCount ||
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const groups: HygieneLabel[][] = [];
  for (const label of labels) {
    const matching = groups.filter(group => group.some(other =>
      nearMatch(normalizeLabel(label.value ?? ""), normalizeLabel(other.value ?? ""))));
    const merged = [label, ...matching.flat()];
    matching.forEach(group => groups.splice(groups.indexOf(group), 1));
    groups.push(merged);
  }
  const coveredLabels = new Set(input.publicViewFilters.flatMap(filters => {
    const parsed = labelFilter.safeParse(filters);
    return parsed.success ? [parsed.data[0].searchPayload[0].id] : [];
  }));
  const ref = (label: HygieneLabel) => ({ id: label.id, name: label.value ?? "" });
  return {
    untaggedOpenTickets: input.untaggedOpenTickets,
    unusedTags: labels.filter(label => label.taskCount === 0).map(ref),
    staleAfterDays: 7,
    columns: input.columns.map(column => ({ ...column, overLimit: column.wipLimit === null ? null : Math.max(0, column.openTickets - column.wipLimit) })),
    duplicateGroups: groups.filter(group => group.length > 1).map(group => {
      const ordered = group.sort((a, b) => labels.indexOf(a) - labels.indexOf(b));
      return { canonical: ref(ordered[0]), labels: ordered.map(ref) };
    }),
    missingViews: labels.filter(label => !coveredLabels.has(label.id)).map(ref),
    titleCaseChanges: labels.flatMap(label => {
      const suggestedName = titleCaseLabel(label.value ?? "");
      return suggestedName && suggestedName !== label.value ? [{ ...ref(label), suggestedName }] : [];
    }),
  };
}

export type BoardHygieneReport = ReturnType<typeof boardHygieneReport>;
