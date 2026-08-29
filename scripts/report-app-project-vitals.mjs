#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(root, "config/app-project-performance-baseline.json"),
    "utf8",
  ),
);
const projectId = process.env.POSTHOG_PROJECT_ID || "236160";
const personalKey =
  process.env.POSTHOG_PERSONAL_API_KEY || process.env.POSTHOG_API_KEY;
const posthogHost = (
  process.env.POSTHOG_API_HOST || "https://eu.posthog.com"
).replace(/\/$/, "");
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Math.min(
  90,
  Math.max(1, Number.parseInt(daysArg?.slice("--days=".length) || "14", 10)),
);
const minimumSamples = baseline.field.minimumSamplesPerMetric;
const physicalDeviceClassSql = `multiIf(
  toString(properties.$device_type) = 'Mobile', 'mobile',
  toString(properties.$device_type) = 'Desktop', 'desktop',
  'unknown'
)`;

if (!personalKey) {
  console.error(
    "Set POSTHOG_PERSONAL_API_KEY (read-only query scope) before running this report.",
  );
  process.exit(2);
}

const fieldQuery = `
SELECT
  ${physicalDeviceClassSql} AS device_class,
  toIntOrZero(toString(properties.app_speed_scope_version)) AS scope_version,
  countIf(properties.$web_vitals_LCP_value IS NOT NULL) AS lcp_samples,
  quantileIf(0.75)(toFloat(properties.$web_vitals_LCP_value), properties.$web_vitals_LCP_value IS NOT NULL) AS lcp_p75_ms,
  countIf(properties.$web_vitals_INP_value IS NOT NULL) AS inp_samples,
  quantileIf(0.75)(toFloat(properties.$web_vitals_INP_value), properties.$web_vitals_INP_value IS NOT NULL) AS inp_p75_ms
FROM events
WHERE event = 'app_project_web_vitals'
  AND timestamp >= now() - INTERVAL ${days} DAY
  AND properties.analytics_surface = 'authenticated_app'
  AND properties.app_hostname = 'app.hypertask.ai'
  AND properties.route_path = '/project'
  AND properties.$device_type IN ('Mobile', 'Desktop')
GROUP BY device_class, scope_version
ORDER BY device_class, scope_version
`.trim();

const readinessDurationSql = "toFloat(properties.duration_ms)";
const readinessDurationValidSql = `${readinessDurationSql} >= 0 AND ${readinessDurationSql} <= 10000`;
const readinessSurfaceSql = `multiIf(
  event = 'app_board_readiness', coalesce(toString(properties.view_surface), 'board_legacy_unknown'),
  event = 'app_inbox_readiness', 'inbox',
  event = 'app_calendar_readiness', 'calendar',
  'unknown'
)`;
const readinessSampleValidSql = `coalesce((${readinessDurationValidSql}) AND if(
  event = 'app_board_readiness',
  toIntOrZero(toString(properties.readiness_measurement_version)) >= 2
    AND toString(properties.readiness_measurement_scope) = 'project_route_entry',
  true
), false)`;
const readinessQuery = `
SELECT
  ${physicalDeviceClassSql} AS device_class,
  ${readinessSurfaceSql} AS surface,
  toString(properties.readiness_source) AS readiness_source,
  count() AS total_samples,
  countIf(${readinessSampleValidSql}) AS valid_samples,
  countIf(NOT ${readinessSampleValidSql}) AS excluded_samples,
  quantileIf(0.5)(${readinessDurationSql}, ${readinessSampleValidSql}) AS p50_ms,
  quantileIf(0.75)(${readinessDurationSql}, ${readinessSampleValidSql}) AS p75_ms
FROM events
WHERE event IN ('app_board_readiness', 'app_inbox_readiness', 'app_calendar_readiness')
  AND timestamp >= now() - INTERVAL ${days} DAY
  AND properties.analytics_surface = 'authenticated_app'
  AND properties.app_hostname = 'app.hypertask.ai'
  AND properties.$device_type IN ('Mobile', 'Desktop')
  AND properties.readiness_source IN ('indexeddb', 'network', 'indexeddb_miss')
GROUP BY device_class, surface, readiness_source
ORDER BY device_class, surface, readiness_source
`.trim();

const taskDetailDurationSql = "toFloat(properties.duration_ms)";
const taskDetailValidSql = `coalesce(
  toString(properties.measurement_eligible) IN ('true', '1')
  AND ${taskDetailDurationSql} >= 0
  AND ${taskDetailDurationSql} <= 30000
  AND toIntOrZero(toString(properties.readiness_measurement_version)) >= 1
  AND toString(properties.readiness_measurement_scope) = 'task_detail_open_to_usable',
  false
)`;
const taskDetailQuery = `
SELECT
  ${physicalDeviceClassSql} AS device_class,
  toString(properties.entry_path) AS entry_path,
  toString(properties.navigation_type) AS navigation_type,
  count() AS total_samples,
  countIf(${taskDetailValidSql}) AS valid_samples,
  countIf(NOT ${taskDetailValidSql}) AS excluded_samples,
  countIf(toString(properties.exclusion_reason) = 'missing_start_marker') AS missing_start,
  countIf(toString(properties.exclusion_reason) = 'duration_out_of_range') AS duration_out_of_range,
  countIf(toString(properties.exclusion_reason) = 'usable_state_timeout') AS usable_state_timeout,
  quantileIf(0.5)(${taskDetailDurationSql}, ${taskDetailValidSql}) AS p50_ms,
  quantileIf(0.75)(${taskDetailDurationSql}, ${taskDetailValidSql}) AS p75_ms,
  quantileIf(0.95)(${taskDetailDurationSql}, ${taskDetailValidSql}) AS p95_ms
FROM events
WHERE event = 'app_task_detail_readiness'
  AND timestamp >= now() - INTERVAL ${days} DAY
  AND properties.analytics_surface = 'authenticated_app'
  AND properties.app_hostname = 'app.hypertask.ai'
  AND properties.$device_type IN ('Mobile', 'Desktop')
GROUP BY device_class, entry_path, navigation_type
ORDER BY device_class, entry_path, navigation_type
`.trim();

const runQuery = async (query) => {
  const response = await fetch(
    `${posthogHost}/api/projects/${projectId}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${personalKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error(`PostHog query failed (${response.status}): ${detail}`);
    process.exit(1);
  }

  return response.json();
};

const [fieldPayload, readinessPayload, taskDetailPayload] = await Promise.all([
  runQuery(fieldQuery),
  runQuery(readinessQuery),
  runQuery(taskDetailQuery),
]);
const statusAgainstBaseline = ({
  samples,
  value,
  referenceSamples,
  reference,
}) => {
  if (samples < minimumSamples) return "insufficient-sample";
  if (referenceSamples < minimumSamples) return "insufficient-baseline";
  return value > reference * (1 + baseline.regressionPercent / 100)
    ? "regression"
    : "pass";
};

const rows = (fieldPayload.results || []).map(
  ([deviceClass, scopeVersion, lcpSamples, lcpP75, inpSamples, inpP75]) => {
    const deviceKey = String(deviceClass).toLowerCase();
    const reference = baseline.field.devices[deviceKey];
    const lcpP75Ms = Math.round(lcpP75 || 0);
    const inpP75Ms = Math.round(inpP75 || 0);
    return {
      deviceClass: deviceKey,
      measurementScope:
        scopeVersion >= 2
          ? `v${scopeVersion}-early-observer`
          : scopeVersion === 1
            ? "v1-late-observer"
            : "unversioned",
      lcpSamples,
      lcpP75Ms,
      lcpRegression: statusAgainstBaseline({
        samples: lcpSamples,
        value: lcpP75Ms,
        referenceSamples: reference?.lcpSamples || 0,
        reference: reference?.lcpP75Ms || 0,
      }),
      lcpTarget:
        deviceKey !== "mobile"
          ? "not-applicable"
          : lcpSamples < minimumSamples
            ? "insufficient-sample"
            : lcpP75Ms <= baseline.field.mobileLcpTargetMs
              ? "target-met"
              : "target-missed",
      inpSamples,
      inpP75Ms,
      inpRegression: statusAgainstBaseline({
        samples: inpSamples,
        value: inpP75Ms,
        referenceSamples: reference?.inpSamples || 0,
        reference: reference?.inpP75Ms || 0,
      }),
      inpTarget:
        inpSamples < minimumSamples
          ? "insufficient-sample"
          : inpP75Ms <= baseline.field.inpTargetMs
            ? "target-met"
            : "target-missed",
    };
  },
);

console.table(rows);
if (rows.length === 0) {
  console.log(
    "No app-only project samples yet; wait for real signed-in traffic before making a release claim.",
  );
}

const readinessRows = (readinessPayload.results || []).map(
  ([
    deviceClass,
    surface,
    readinessSource,
    totalSamples,
    validSamples,
    excludedSamples,
    p50Ms,
    p75Ms,
  ]) => ({
    deviceClass,
    surface,
    readinessSource,
    totalSamples,
    validSamples,
    excludedSamples,
    p50Ms: Math.round(p50Ms || 0),
    p75Ms: Math.round(p75Ms || 0),
    windowDays: days,
  }),
);

console.log(
  "\nAuthenticated app readiness (invalid scope and samples outside 0-10s excluded):",
);
console.table(readinessRows);

const taskDetailRows = (taskDetailPayload.results || []).map((row) => ({
  deviceClass: row[0],
  entryPath: row[1],
  navigationType: row[2],
  totalSamples: row[3],
  validSamples: row[4],
  excludedSamples: row[5],
  missingStart: row[6],
  durationOutOfRange: row[7],
  usableStateTimeout: row[8],
  p50Ms: Math.round(row[9] || 0),
  p75Ms: Math.round(row[10] || 0),
  p95Ms: Math.round(row[11] || 0),
  targetStatus: row[4] >= 20 ? "ready-to-set-target" : "insufficient-sample",
  windowDays: days,
}));

console.log(
  "\nTask detail open-to-usable by device, entry path, and navigation type:",
);
console.table(taskDetailRows);
