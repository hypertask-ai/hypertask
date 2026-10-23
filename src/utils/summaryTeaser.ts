export function summaryTeaser(markdown: string): string {
  const lines = (markdown || "").split("\n").map((l) => l.trim());
  const firstBullet = lines.find((l) => l.startsWith("- "));
  const first = firstBullet
    ? firstBullet.replace(/^-\s*/, "")
    : lines.find((l) => l && !l.startsWith("#")) || markdown;
  return first
    .replace(/^#+\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s*\[\d+\]\s*$/, "")
    .trim();
}
