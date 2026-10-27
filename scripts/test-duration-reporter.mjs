import path from "node:path";

export default async function* testDurationReporter(source) {
  for await (const { type, data } of source) {
    if (
      type === "test:complete" &&
      data.nesting === 0 &&
      !data.entryFile &&
      data.file &&
      path.resolve(data.name) === path.resolve(data.file)
    ) {
      yield `${JSON.stringify({
        file: path.relative(process.cwd(), data.file).split(path.sep).join("/"),
        durationMs: data.details.duration_ms,
      })}\n`;
    }
  }
}
