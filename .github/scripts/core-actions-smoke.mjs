import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://app.hypertask.ai";
const TOKEN = process.env.HYPERTASK_MCP_TOKEN || "";
const BOARD_TITLE = "Hypertask production core-actions smoke";
const TASK_TITLE = "Core actions smoke fixture";
const AGENT_NAME = "Core Actions Smoke Agent";
// Dev agents skip anything carrying this label (HT_EXCLUDE_LABELS), so the
// fixture task can never be picked up as real work.
const FIXTURE_LABEL = "qa-fixture";

export class ApiRequestError extends Error {
  constructor(path, status, message) {
    super(`${path} failed: ${message}`);
    this.status = status;
  }
}

const ALERT_PROJECT_ID = 15;
const ALERT_SECTION_ID = 4389;
const PARENT_TICKET = process.env.CORE_SMOKE_PARENT_TICKET || "HTPR-6225";
if (!/^HTPR-[1-9][0-9]*$/.test(PARENT_TICKET)) {
  throw new Error("CORE_SMOKE_PARENT_TICKET must be an HTPR ticket number");
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

async function api(path, options = {}) {
  if (!TOKEN) throw new Error("HYPERTASK_MCP_TOKEN is required");
  const response = await fetch(new URL(path, BASE_URL), {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    const detail = data?.message || data?.error || `HTTP ${response.status}`;
    throw new ApiRequestError(
      path,
      response.status,
      String(detail).slice(0, 240),
    );
  }
  return data;
}

// Resolves the dedicated fixture by NAME on every run, creating it once if it
// is absent. Nothing here is keyed on a stored id, so a renamed column or a
// re-created board can never point the probe at a real user's work
// (HTPR-6255, HTPR-6258).
export async function provision() {
  const context = await api("/api/mcp/user/context");
  if (context.connected_agent)
    throw new Error(
      "HYPERTASK_MCP_TOKEN must be a user token, not an agent token",
    );

  const findTeam = () => {
    const team = process.env.CORE_SMOKE_TEAM_ID
      ? context.teams?.find((item) => item.id === process.env.CORE_SMOKE_TEAM_ID)
      : context.teams?.find((item) => item.title === "Hypertask");
    if (!team)
      throw new Error(
        "CORE_SMOKE_TEAM_ID is required when the health identity has no Hypertask team",
      );
    return team;
  };

  let project = context.projects?.find(
    (item) => item.title === BOARD_TITLE && item.ownerId === context.user.id,
  );
  let task;
  if (!project) {
    const created = await api(
      `/api/mcp/teams/${encodeURIComponent(findTeam().id)}/boards`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "htpr-6236-core-actions-fixture" },
        body: JSON.stringify({
          title: BOARD_TITLE,
          description:
            "Persistent production fixture for HTPR-6236. Do not edit by hand.",
          sections: [{ title: "Baseline" }, { title: "Alternate" }],
          labels: [{ name: FIXTURE_LABEL }],
          tasks: [
            {
              title: TASK_TITLE,
              description:
                "Persistent smoke target. The monitor restores it after every run.",
              section_index: 0,
              label_names: [FIXTURE_LABEL],
              priority: 0,
              estimate: 0,
            },
          ],
        }),
      },
    );
    project = { ...created.board, sections: created.sections };
    task = created.tasks?.find((item) => item.title === TASK_TITLE);
  } else {
    const tasks = await api(
      `/api/mcp/tasks?project_id=${project.id}&status=Normal&search=${encodeURIComponent(TASK_TITLE)}&limit=10`,
    );
    task = tasks.tasks?.find((item) => item.title === TASK_TITLE);
    // Labels can only be set when a task is created, so a pre-existing fixture
    // cannot be relabelled from here. Refuse to drive an unlabelled task
    // rather than mutate one a dev agent might also pick up.
    if (
      task &&
      !(task.labels ?? []).some((label) => label?.name === FIXTURE_LABEL)
    ) {
      throw new Error(
        `The fixture task is missing the ${FIXTURE_LABEL} label; add it by hand so agents skip it`,
      );
    }
  }
  if (!task) throw new Error("The fixture task is missing");

  const listedAgents = await api("/api/mcp/agents");
  let agent = listedAgents.agents?.find(
    (item) => item.display_name === AGENT_NAME && item.revoked === false,
  );
  if (!agent) {
    const created = await api("/api/mcp/agents/create", {
      method: "POST",
      headers: { "Idempotency-Key": "htpr-6236-core-actions-agent" },
      body: JSON.stringify({
        display_name: AGENT_NAME,
        project_ids: [project.id],
        role: "read",
      }),
    });
    agent = {
      id: created.agent?.id,
      display_name: created.agent?.display_name,
      boards: [{ id: project.id }],
    };
  } else if (!agent.boards?.some((board) => board.id === project.id)) {
    await api(`/api/mcp/projects/${project.id}/members`, {
      method: "POST",
      body: JSON.stringify({ userToAdd: agent.id }),
    });
  }
  if (!agent?.id) throw new Error("The fixture agent is missing");

  await api("/api/mcp/assignees/assign", {
    method: "POST",
    body: JSON.stringify({
      task_id: task.id,
      agent_id: agent.id,
      intent: "assign",
    }),
  });

  const projects = await api(
    `/api/mcp/projects?search=${encodeURIComponent(BOARD_TITLE)}&limit=10`,
  );
  const fullProject = projects.projects?.find((item) => item.id === project.id);
  const base = fullProject?.sections?.find(
    (item) => item.section_title === "Baseline",
  );
  const alternate = fullProject?.sections?.find(
    (item) => item.section_title === "Alternate",
  );
  if (!base || !alternate) throw new Error("The fixture columns are missing");

  return {
    projectId: project.id,
    taskId: task.id,
    baseSectionId: base.id,
    altSectionId: alternate.id,
    agentId: agent.id,
  };
}

export async function run(options = {}) {
  const fixture = {
    ...(await provision()),
    runId: process.env.GITHUB_RUN_ID || `local-${Date.now()}`,
  };

  const isProbeResult = (value) =>
    value !== null &&
    typeof value === "object" &&
    typeof value.ok === "boolean" &&
    (value.ok
      ? value.kind === "pass"
      : value.kind === "application" || value.kind === "unrunnable") &&
    typeof value.action === "string" &&
    value.action.length > 0 &&
    typeof value.detail === "string" &&
    Array.isArray(value.steps) &&
    value.steps.every((step) => typeof step === "string") &&
    Array.isArray(value.cleanup) &&
    value.cleanup.every((step) => typeof step === "string") &&
    (value.status === undefined || Number.isInteger(value.status));

  const invoke = async () => {
    const response = await api("/api/ops/core-actions-smoke", {
      method: "POST",
      body: JSON.stringify(fixture),
    });
    const result = response?.result;
    if (!isProbeResult(result)) throw new Error("The probe returned a malformed result");
    return result;
  };

  const first = await invoke();
  if (first.ok || first.kind !== "application") return first;

  await (
    options.sleep ||
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)))
  )(1_000);
  const confirmation = await invoke();
  if (sameApplicationFailure(first, confirmation)) {
    return {
      ...confirmation,
      rollbackEligible: true,
      detail: `confirmed twice: ${confirmation.detail}`,
    };
  }
  if (confirmation.ok) {
    return {
      ...confirmation,
      detail: `passed confirmation retry after ${first.action}`,
    };
  }
  return {
    ...confirmation,
    kind: "unrunnable",
    action: "confirm application failure",
    detail: `first failure was ${first.action}; confirmation returned ${confirmation.action}`,
  };
}

export function sameApplicationFailure(first, confirmation) {
  return (
    first?.kind === "application" &&
    confirmation?.kind === "application" &&
    confirmation.action === first.action &&
    (confirmation.status ?? null) === (first.status ?? null) &&
    confirmation.detail === first.detail
  );
}

export function shouldRollback(result, eventName) {
  return (
    eventName === "push" &&
    result?.kind === "application" &&
    result?.rollbackEligible === true
  );
}

// A credential or workspace problem is not a monitoring signal: no deploy can
// cause it and no code change fixes it. It still fails the job, but reporting
// it to the board on every five-minute run would bury the real alerts.
const SETUP_ERROR_MESSAGES = [
  "must be a user token",
  "HYPERTASK_MCP_TOKEN is required",
  "CORE_SMOKE_TEAM_ID is required",
  `is missing the ${FIXTURE_LABEL} label`,
];

export function isSetupFailure(error) {
  const status = error instanceof ApiRequestError ? error.status : undefined;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return SETUP_ERROR_MESSAGES.some((needle) => message.includes(needle));
}

export function classifyProbeStartFailure(error) {
  const status = error instanceof ApiRequestError ? error.status : undefined;
  return {
    ok: false,
    kind: "unrunnable",
    action: "start core-actions probe",
    ...(status !== undefined ? { status } : {}),
    ...(isSetupFailure(error) ? { setupError: true } : {}),
    detail:
      error instanceof Error
        ? error.message.slice(0, 240)
        : "probe request failed",
    steps: [],
    cleanup: [],
  };
}

export async function report(result) {
  if (result?.setupError === true) {
    // Loud in the run log, silent on the board: see SETUP_ERROR_MESSAGES.
    // Workflow commands are only parsed off stdout, never stderr.
    process.stdout.write(
      `::error::Core-actions smoke cannot run until its credentials are fixed: ${result.detail}\n`,
    );
    return;
  }
  const rollback = process.env.CORE_SMOKE_ROLLBACK || "not requested";
  const runUrl =
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "no run URL";
  const status = result.status
    ? `server response ${result.status}`
    : "no server response";
  const sentence = `Core-action smoke ${result.kind}. ${result.action} returned ${status}. ${result.detail}. Rollback ${rollback}.`;
  const html = `<p><strong>${escapeHtml(sentence)}</strong></p><p><a href="${escapeHtml(runUrl)}">Workflow run</a></p>`;

  const postTicket = () =>
    api("/api/mcp/comments", {
      method: "POST",
      headers: {
        "Idempotency-Key": `core-smoke-6225-${process.env.GITHUB_RUN_ID || Date.now()}`,
      },
      body: JSON.stringify({
        ticket_number: PARENT_TICKET,
        project_id: ALERT_PROJECT_ID,
        text: html,
        content_type: "html",
      }),
    });

  const postIncident = async () => {
    const incidentTitle = `[INCIDENT] Core-action smoke: ${String(result.action).slice(0, 100)}`;
    const found = await api(
      `/api/mcp/tasks?project_id=${ALERT_PROJECT_ID}&status=Normal&search=${encodeURIComponent(incidentTitle)}&limit=10`,
    );
    let incident = found.tasks?.find((item) => item.title === incidentTitle);
    if (!incident) {
      const projects = await api(
        "/api/mcp/projects?search=Hypertask%20Product&limit=20",
      );
      const board = projects.projects?.find(
        (item) => item.id === ALERT_PROJECT_ID,
      );
      const bugs = board?.sections?.find(
        (item) => item.id === ALERT_SECTION_ID,
      );
      if (!bugs) {
        throw new Error(
          `Core-smoke report section ${ALERT_SECTION_ID} is missing from project ${ALERT_PROJECT_ID}`,
        );
      }
      const key = createHash("sha256")
        .update(incidentTitle)
        .digest("hex")
        .slice(0, 24);
      let created;
      try {
        created = await api("/api/mcp/tasks/create", {
          method: "POST",
          headers: { "Idempotency-Key": `core-smoke-incident-${key}` },
          body: JSON.stringify({
            project_id: ALERT_PROJECT_ID,
            section_id: bugs.id,
            title: incidentTitle,
            description: html,
          }),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Core-smoke incident report to project ${ALERT_PROJECT_ID} section ${bugs.id} failed: ${reason}`,
        );
      }
      incident = created.task;
    }
    if (!incident?.id) throw new Error("The incident task was not returned");
    await api("/api/mcp/comments", {
      method: "POST",
      headers: {
        "Idempotency-Key": `core-smoke-incident-comment-${process.env.GITHUB_RUN_ID || Date.now()}`,
      },
      body: JSON.stringify({
        task_id: incident.id,
        text: html,
        content_type: "html",
      }),
    });
  };

  const reports = await Promise.allSettled([postTicket(), postIncident()]);
  const failures = reports.filter((item) => item.status === "rejected");
  if (failures.length > 0) {
    const reasons = failures
      .map((item) =>
        item.reason instanceof Error
          ? item.reason.message
          : String(item.reason),
      )
      .join("; ")
      .slice(0, 500);
    throw new Error(
      `${failures.length} core-smoke report destination(s) failed: ${reasons}`,
    );
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "provision") {
    const fixture = await provision();
    await writeFile(
      process.env.CORE_SMOKE_FIXTURE_FILE || "core-smoke-fixture.json",
      JSON.stringify(fixture),
    );
    process.stdout.write(`${JSON.stringify(fixture)}\n`);
    return;
  }
  if (command === "run") {
    let result;
    try {
      result = await run();
    } catch (error) {
      result = classifyProbeStartFailure(error);
    }
    await writeFile(
      process.env.CORE_SMOKE_RESULT_FILE || "core-smoke-result.json",
      JSON.stringify(result),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "report") {
    const result = JSON.parse(
      await readFile(
        process.env.CORE_SMOKE_RESULT_FILE || "core-smoke-result.json",
        "utf8",
      ),
    );
    await report(result);
    return;
  }
  if (command === "rollback-decision") {
    const result = JSON.parse(
      await readFile(
        process.env.CORE_SMOKE_RESULT_FILE || "core-smoke-result.json",
        "utf8",
      ),
    );
    process.stdout.write(
      `${shouldRollback(result, process.env.GITHUB_EVENT_NAME)}\n`,
    );
    return;
  }
  throw new Error(
    "Usage: core-actions-smoke.mjs <provision|run|report|rollback-decision>",
  );
}

if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
