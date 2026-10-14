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
