export type AiLabelDefinition = {
  labelId: string;
  prompt: string;
};

// Models sometimes wrap JSON in a markdown code fence despite instructions.
const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

// Returns null when the model's output isn't a parseable JSON array at all
// (caller must treat that as "no verdict", not "remove all labels").
// Unknown/non-string entries inside an otherwise-valid array are dropped,
// not treated as a fatal parse error.
export function parseMatchingLabelIds(
  text: string,
  definitions: AiLabelDefinition[]
): string[] | null {
  const fenceMatch = text.trim().match(CODE_FENCE);
  const unfenced = fenceMatch ? fenceMatch[1] : text;

  try {
    const parsed: unknown = JSON.parse(unfenced);
    if (!Array.isArray(parsed)) return null;

    const allowedIds = new Set(definitions.map(({ labelId }) => labelId));
    const validIds = parsed.filter(
      (id): id is string => typeof id === "string" && allowedIds.has(id)
    );
    return [...new Set(validIds)];
  } catch {
    return null;
  }
}
