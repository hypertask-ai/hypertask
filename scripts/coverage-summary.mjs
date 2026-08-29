import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const metrics = ["statements", "branches", "functions", "lines"];

export const criticalDomains = [
  {
    id: "auth_access",
    label: "Auth / access",
    patterns: [
      /^src\/(?:app|pages)\/api\/auth\//,
      /^src\/(?:app|pages)\/api\/invite\//,
      /^src\/app\/api\/calendar\/access\//,
      /^src\/lib\/auth\//,
      /(?:^|\/)(?:access|authorization|membership|permissions?)(?:[./_-]|$)/i,
    ],
  },
  {
    id: "task_writes",
    label: "Task writes",
    patterns: [
      /^src\/(?:app|pages)\/api\/tasks?\//,
      /^src\/lib\/mcp\/tasks\//,
      /^src\/utils\/controllers\/.*task/i,
      /(?:^|\/)(?:create|update|delete|move|archive).*task/i,
    ],
  },
  {
    id: "billing",
    label: "Billing",
    patterns: [/(?:^|\/)(?:billing|stripe)(?:\/|[._-])/i],
  },
  {
    id: "agents_ai_writes",
    label: "Agents / AI writes",
    patterns: [
      /^src\/app\/api\/(?:agents|ai|ai-chat|mcp)(?:\/|$)/,
      /^src\/lib\/(?:agents|ai|aiChat|mcp|mcp-server)(?:\/|$)/,
    ],
  },
  {
    id: "realtime_notifications",
    label: "Realtime / notifications",
    patterns: [/(?:^|\/)(?:notifications?|realtime|pusher)(?:\/|[._-])/i],
  },
  {
    id: "release_controls",
    label: "Release controls",
    patterns: [
      /^\.github\/scripts\//,
      /^scripts\/(?:check-app-performance-budget|coverage-summary|report-app-project-vitals|run-production-migrations|run-tests|test-inventory)\./,
    ],
  },
];

function emptyMetric() {
  return { total: 0, covered: 0, skipped: 0, pct: null };
}

function emptyAggregate() {
  return Object.fromEntries(metrics.map((metric) => [metric, emptyMetric()]));
}

function finishMetric(metric) {
  return {
    ...metric,
    pct:
      metric.total === 0
        ? null
        : Math.round((metric.covered / metric.total) * 10_000) / 100,
  };
}

function normalizeFile(file, root) {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  return relative.split(path.sep).join("/");
}

export function classifyCoverageFile(file) {
  return (
    criticalDomains.find((domain) =>
      domain.patterns.some((pattern) => pattern.test(file)),
    ) ?? { id: "other_production", label: "Other production code" }
  );
}

export function buildCoverageBaseline(rawSummary, { root = process.cwd() } = {}) {
  const domainMap = new Map(
    [...criticalDomains, { id: "other_production", label: "Other production code" }].map(
      (domain) => [
        domain.id,
        { id: domain.id, label: domain.label, files: 0, ...emptyAggregate() },
      ],
    ),
  );
  const files = [];

  for (const [rawFile, coverage] of Object.entries(rawSummary)) {
    if (rawFile === "total") continue;
    const file = normalizeFile(rawFile, root);
    const domain = classifyCoverageFile(file);
    const aggregate = domainMap.get(domain.id);
    aggregate.files += 1;

    for (const metric of metrics) {
      aggregate[metric].total += coverage[metric]?.total ?? 0;
      aggregate[metric].covered += coverage[metric]?.covered ?? 0;
      aggregate[metric].skipped += coverage[metric]?.skipped ?? 0;
    }

    const lineTotal = coverage.lines?.total ?? 0;
    const lineCovered = coverage.lines?.covered ?? 0;
    files.push({
      file,
      domain: domain.id,
      lineTotal,
      lineCovered,
      uncoveredLines: Math.max(0, lineTotal - lineCovered),
    });
  }

  const domains = [...domainMap.values()].map((domain) => ({
    ...domain,
    ...Object.fromEntries(
      metrics.map((metric) => [metric, finishMetric(domain[metric])]),
    ),
  }));

  const largestCriticalGaps = files
    .filter(
      (file) => file.domain !== "other_production" && file.uncoveredLines > 0,
    )
    .sort(
      (left, right) =>
        right.uncoveredLines - left.uncoveredLines ||
        left.file.localeCompare(right.file),
    )
    .slice(0, 15);

  return {
    schemaVersion: 1,
    reportOnly: true,
    generatedAt: new Date().toISOString(),
    domains,
    largestCriticalGaps,
  };
}

function percent(metric) {
  return metric.pct === null ? "—" : `${metric.pct.toFixed(2)}%`;
}

export function renderCoverageMarkdown(baseline) {
  const rows = baseline.domains
    .map(
      (domain) =>
        `| ${domain.label} | ${domain.files} | ${percent(domain.lines)} | ${percent(domain.branches)} | ${percent(domain.functions)} |`,
    )
    .join("\n");
  const gaps =
    baseline.largestCriticalGaps.length === 0
      ? "No uncovered critical files were measured."
      : [
          "| Domain | File | Uncovered lines |",
          "| --- | --- | ---: |",
          ...baseline.largestCriticalGaps.map((gap) => {
            const label =
              baseline.domains.find((domain) => domain.id === gap.domain)?.label ??
              gap.domain;
            return `| ${label} | \`${gap.file}\` | ${gap.uncoveredLines} |`;
          }),
        ].join("\n");

  return `# Automated test coverage baseline

**This report is diagnostic, not a merge threshold.** It measures production code exercised by the automated suite and makes zero-coverage files visible.

| Critical domain | Files measured | Lines | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
${rows}

## Largest critical gaps

${gaps}

Percentages should become enforcement thresholds only after several stable runs and targeted behavioral-test improvements.
`;
}

export async function writeCoverageBaseline({
  input = "coverage/report/coverage-summary.json",
  outputJson = "coverage/critical-domains.json",
  outputMarkdown = "coverage/critical-domains.md",
  root = process.cwd(),
} = {}) {
  const rawSummary = JSON.parse(await readFile(path.resolve(root, input), "utf8"));
  const baseline = buildCoverageBaseline(rawSummary, { root });
  const markdown = renderCoverageMarkdown(baseline);

  await writeFile(path.resolve(root, outputJson), `${JSON.stringify(baseline, null, 2)}\n`);
  await writeFile(path.resolve(root, outputMarkdown), markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
  }
  return baseline;
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMain) {
  const baseline = await writeCoverageBaseline();
  console.log(
    `Coverage baseline written for ${baseline.domains.reduce((sum, domain) => sum + domain.files, 0)} production files.`,
  );
}
