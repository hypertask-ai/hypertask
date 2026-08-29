// Comment/description bodies are HTML (e.g. <a href="...pull/1703">...</a>), so the
// character class must stop at quotes and angle brackets, not just spaces/parens —
// otherwise a greedy match swallows the `">` and glues two URLs together.
const GITHUB_PR_URL_PATTERN = /https:\/\/github\.com\/[^\s"'<>)]+\/pull\/\d+/g;

export function extractPrLinks(
  ...contents: Array<string | null | undefined>
): string[] {
  const links = new Set<string>();

  for (const content of contents) {
    if (!content) continue;

    for (const link of content.match(GITHUB_PR_URL_PATTERN) ?? []) {
      links.add(link);
    }
  }

  return [...links];
}
