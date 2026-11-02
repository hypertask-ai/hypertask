// HYCI-82 — only a production push may publish the baseline a comparison reuses.
//
// ci-tests.yml downloads a published baseline instead of rebuilding the base app.
// The artifact API filters by name alone, so any run, including a pull request
// that uploads the same name, could publish the screenshots another pull request
// compares against and hide the regression the gate exists to catch. Only an
// artifact of a successful visual-regression.yml run on a production push at the
// base commit is trusted; anything else rebuilds the base.
import { readFileSync } from "node:fs";

export const PRODUCER_BRANCH = "production";
export const PRODUCER_PATH = ".github/workflows/visual-regression.yml";

export function selectPublishedBaseline(artifacts, sha) {
  const trusted = (Array.isArray(artifacts) ? artifacts : [])
    .filter(
      (artifact) =>
        artifact?.expired === false &&
        artifact.workflow_run?.head_branch === PRODUCER_BRANCH &&
        artifact.workflow_run?.head_sha === sha,
    )
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const newest = trusted.at(-1);
  return newest ? { artifactId: newest.id, runId: newest.workflow_run.id } : null;
}

export function isTrustedProducer(run, sha) {
  return Boolean(
    run &&
      run.path === PRODUCER_PATH &&
      run.head_branch === PRODUCER_BRANCH &&
      run.head_sha === sha &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
}

function main() {
  const [mode, sha] = process.argv.slice(2);
  if (!sha || (mode !== "select" && mode !== "trust")) {
    throw new Error("usage: published-baseline.mjs <select|trust> <base sha>");
  }
  const payload = JSON.parse(readFileSync(0, "utf8"));
  if (mode === "select") {
    const match = selectPublishedBaseline(payload.artifacts, sha);
    if (match) console.log(`${match.artifactId} ${match.runId}`);
    return;
  }
  if (!isTrustedProducer(payload, sha)) process.exitCode = 1;
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
