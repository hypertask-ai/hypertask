"use strict";

const fs = require("node:fs");

function mergePublishedReport(previous, fixture) {
  if (!Array.isArray(fixture?.surfaces) || !fixture?.summary?.byTransport) {
    throw new Error("fixture report is missing surface measurements");
  }

  if (!Array.isArray(previous?.rows) || previous.rows.length === 0) {
    return fixture;
  }
  if (!previous.summary?.byClient) {
    throw new Error("published client report is missing client summary");
  }

  return {
    ...previous,
    surfaces: fixture.surfaces,
    summary: {
      ...previous.summary,
      byTransport: fixture.summary.byTransport,
      surfaceFailed: fixture.summary.surfaceFailed,
    },
  };
}

if (require.main === module) {
  const [previousPath, fixturePath, outputPath] = process.argv.slice(2);
  if (!previousPath || !fixturePath || !outputPath) {
    throw new Error("usage: merge-report.cjs <previous> <fixture> <output>");
  }
  const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(mergePublishedReport(previous, fixture), null, 2)}\n`,
  );
}

module.exports = { mergePublishedReport };
