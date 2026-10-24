const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const net = require("node:net");
const yaml = require("js-yaml");

function connectThroughProxy(port, target, authorization) {
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization ? `Proxy-Authorization: ${authorization}\r\n` : ""}\r\n`,
      );
    });
    socket.setTimeout(2_000, () =>
      socket.destroy(new Error("proxy response timed out")),
    );
    socket.once("error", reject);
    socket.on("data", (data) => {
      response += data.toString();
      if (!response.includes("\r\n\r\n")) return;
      socket.destroy();
      resolve(response);
    });
  });
}

function startProxy(t) {
  const proxy = spawn(
    process.execPath,
    ["scripts/npm-registry-smoke-proxy.mjs"],
    {
      env: {
        ...process.env,
        SMOKE_PROXY_HOST: "127.0.0.1",
        SMOKE_PROXY_PORT: "0",
        SMOKE_PROXY_TOKEN: "test-token",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  t.after(() => proxy.kill());
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timer = setTimeout(
      () => finish(reject)(new Error("proxy did not report its port")),
      2_000,
    );
    const finish = (operation) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation(value);
    };
    proxy.once("error", finish(reject));
    proxy.once(
      "close",
      finish((status) => reject(new Error(`proxy exited with ${status}`))),
    );
    proxy.stdout.on("data", (data) => {
      output += data.toString();
      const match = output.match(/^PORT=(\d+)$/m);
      if (match) finish(resolve)(Number(match[1]));
    });
  });
}

test("app smoke validates the head before isolated build and route checks", async () => {
  const workflow = await readFile(".github/workflows/app-smoke.yml", "utf8");
  const request = await readFile(
    ".github/workflows/app-smoke-request.yml",
    "utf8",
  );
  const isolated = await readFile("scripts/run-app-smoke-isolated.sh", "utf8");
  const seed = await readFile("scripts/seed-core-actions-smoke.mjs", "utf8");
  const prismaEngine = await readFile(
    "scripts/fetch-prisma-smoke-engine.mjs",
    "utf8",
  );
  const npmProxy = await readFile(
    "scripts/npm-registry-smoke-proxy.mjs",
    "utf8",
  );
  const searchMock = await readFile(
    "scripts/turbopuffer-smoke-mock.mjs",
    "utf8",
  );
  const nextConfig = await readFile("next.config.js", "utf8");
  const parsedWorkflow = yaml.load(workflow);
  const workflowJson = JSON.stringify(parsedWorkflow);
  const uses = Object.values(parsedWorkflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
  );

  assert.match(workflow, /name: run app-smoke/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(request, /branches: \[production\]/);
  assert.match(
    request,
    /types: \[opened, synchronize, reopened, ready_for_review\]/,
  );
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["App Smoke Request"\]/);
  assert.match(
    workflow,
    /format\('app-smoke-\{0\}-\{1\}', github\.event\.workflow_run\.head_repository\.full_name, github\.event\.workflow_run\.head_branch\)/,
