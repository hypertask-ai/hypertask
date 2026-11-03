// HYCI-82 — only a production push may publish the baseline a comparison reuses.
// HYCI-99 — the baseline is identified by the render source it was captured from,
// not by the base commit, so a production commit whose own publish is missing or
// evicted still reuses screenshots from an identical tree.
//
// ci-tests.yml downloads a published baseline instead of rebuilding the base app.
// The artifact API filters by name alone, so any run, including a pull request
// that uploads the same name, could publish the screenshots another pull request
// compares against and hide the regression the gate exists to catch. A branch
// name is not a trust signal, and the artifact listing carries no event, so the
// run is fetched and must be a successful visual-regression.yml push run on
// production; the name carries the runner image, the base render-source
// fingerprint and the harness fingerprint, which the producer computes from its
// own checkout. Anything else rebuilds the base.
import { readFileSync } from "node:fs";

export const PRODUCER_BRANCH = "production";
export const PRODUCER_EVENT = "push";
export const PRODUCER_PATH = ".github/workflows/visual-regression.yml";

export function selectPublishedBaseline(artifacts) {
  const trusted = (Array.isArray(artifacts) ? artifacts : [])
    .filter(
      (artifact) =>
        artifact?.expired === false && artifact.workflow_run?.head_branch === PRODUCER_BRANCH,
    )
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const newest = trusted.at(-1);
  return newest ? { artifactId: newest.id, runId: newest.workflow_run.id } : null;
}

export function isTrustedProducer(run) {
  return Boolean(
    run &&
      run.event === PRODUCER_EVENT &&
      run.path === PRODUCER_PATH &&
      run.head_branch === PRODUCER_BRANCH &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
}

function main() {
  const [mode] = process.argv.slice(2);
  if (mode !== "select" && mode !== "trust") {
    throw new Error("usage: published-baseline.mjs <select|trust>");
  }
  const payload = JSON.parse(readFileSync(0, "utf8"));
  if (mode === "select") {
    const match = selectPublishedBaseline(payload.artifacts);
    if (match) console.log(`${match.artifactId} ${match.runId}`);
    return;
  }
  if (!isTrustedProducer(payload)) process.exitCode = 1;
}

// Importable for tests; only the direct invocation reads standard input.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (error) {
    console.error(`Published baseline selection error: ${error.message}`);
    process.exitCode = 2;
  }
}
