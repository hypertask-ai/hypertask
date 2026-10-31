import path from "node:path";

function relative(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

export default async function* testDurationReporter(source) {
  const wholeFiles = new Set();
  const sharedTotals = new Map();
  for await (const { type, data } of source) {
    if (type !== "test:complete" || !data.file || data.nesting !== 0) continue;
    const duration = data.details?.duration_ms;
    if (!Number.isFinite(duration)) continue;
    if (!data.entryFile && path.resolve(data.name) === path.resolve(data.file)) {
      wholeFiles.add(relative(data.file));
      yield `${JSON.stringify({ file: relative(data.file), durationMs: duration })}\n`;
      continue;
    }
    const file = relative(data.file);
    sharedTotals.set(file, (sharedTotals.get(file) ?? 0) + duration);
  }
  if (wholeFiles.size > 0) return;
  for (const [file, durationMs] of [...sharedTotals].sort((a, b) => a[0].localeCompare(b[0]))) {
    yield `${JSON.stringify({ file, durationMs, shared: true })}\n`;
  }
}
