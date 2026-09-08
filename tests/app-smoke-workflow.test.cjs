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
    /types: \[opened, synchronize, reopened, ready_for_review, edited\]/,
  );
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["App Smoke Request"\]/);
  assert.match(
    workflow,
    /format\('app-smoke-\{0\}', github\.event\.workflow_run\.head_sha\)/,
  );
  assert.match(
    workflow,
    /cancel-in-progress: \$\{\{ github\.event_name == 'push' \}\}/,
  );
  assert.match(
    workflow,
    /name: warm app-smoke dependencies\s+if: github\.event_name == 'push'/,
  );
  assert.ok(
    uses.includes(
      "actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830",
    ),
  );
  assert.match(
    workflow,
    /hashFiles\('package-lock\.json', 'package\.json', '\.npmrc', 'prisma\.config\.ts', 'src\/prisma\/\*\*'\)/,
  );
  assert.match(workflow, /commits\/\$REQUEST_HEAD_SHA\/pulls/);
  assert.match(workflow, /if length == 1 then \.\[0\]\.number else empty end/);
  assert.match(workflow, /\.head\.sha == \$sha/);
  assert.match(
    workflow,
    /name: run app-smoke\s+needs: validate\s+runs-on: ubuntu-latest/,
  );
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(
    workflow,
    /repository: \$\{\{ needs\.validate\.outputs\.head-repository \}\}/,
  );
  assert.match(workflow, /ref: \$\{\{ needs\.validate\.outputs\.head-sha \}\}/);
  assert.match(workflow, /path: candidate/);
  assert.ok(
    uses.includes(
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    ),
  );
  assert.match(workflow, /node-version: 22/);
  assert.ok(
    uses.includes(
      "actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830",
    ),
  );
  assert.match(workflow, /path: node_modules/);
  assert.match(workflow, /CORE_SMOKE_TRUSTED_DEPENDENCIES/);
  assert.match(workflow, /name: Install production smoke dependencies/);
  assert.match(workflow, /npm ci --no-audit --no-fund && npx prisma generate/);
  assert.match(
    isolated,
    /timeout --signal=KILL 2m docker run --rm --name "\$harness"/,
  );
  assert.match(
    isolated,
    /--name "\$harness"[\s\S]*--read-only[\s\S]*--tmpfs \/tmp:rw,nosuid,nodev,size=16m/,
  );
  assert.match(isolated, /turbopuffer-smoke-mock\.mjs/);
  assert.match(searchMock, /namespaces\/tasks\/query/);
  assert.match(searchMock, /rows: \[fixture\]/);
  assert.match(searchMock, /unexpected request/);
  assert.match(searchMock, /isTaskQuery \? 200 : 404/);
  assert.match(npmProxy, /upstream\.setTimeout\(30_000/);
  assert.match(npmProxy, /upstream\.destroy\(\)[\s\S]*client\.destroy\(\)/);
  assert.match(npmProxy, /client\.on\("close"/);
  assert.match(searchMock, /request\.resume\(\)/);
  assert.match(workflow, /bash scripts\/run-app-smoke-isolated\.sh/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /PR: \$\{\{ needs\.validate\.outputs\.pr \}\}/);
  assert.match(workflow, /-f context=app-smoke/);
  assert.match(workflow, /gh workflow run automerge\.yml .* -f pr="\$PR"/);
  assert.doesNotMatch(workflowJson, /\"secrets\"\s*:|\bsecrets\s*(?:\.|\[)/);

  assert.match(isolated, /docker network create --internal/);
  assert.match(isolated, /docker network create "\$egress_network"/);
  assert.match(isolated, /--opt o=size=5g "\$build"/);
  assert.match(isolated, /--opt o=size=16m "\$state"/);
  assert.match(isolated, /--opt o=size=4g "\$dependencies"/);
  assert.match(isolated, /volume_keeper="ht-smoke-volume-keeper-\$run_key"/);
  assert.match(isolated, /"\$runtime_image" sleep infinity/);
  assert.match(
    isolated,
    /candidate_root=\$\(cd "\$candidate_root" && pwd -P\)/,
  );
  assert.match(isolated, /for candidate_mount in node_modules \.next/);
  assert.match(isolated, /\[ -L "\$mount_target" \]/);
  assert.match(isolated, /mkdir -p "\$mount_target"/);
  assert.match(
    isolated,
    /next_env_target="\$candidate_root\/next-env\.d\.ts"/,
  );
  assert.match(
    isolated,
    /Candidate next-env\.d\.ts mount target must be a regular file/,
  );
  assert.match(isolated, /next_env="\$scratch\/next-env\.d\.ts"/);
  assert.match(isolated, /: >"\$next_env"/);
  assert.match(isolated, /chmod 0666 "\$next_env"/);
  assert.match(
    isolated,
    /--name "\$builder"[\s\S]*-v "\$next_env:\/app\/next-env\.d\.ts:rw"[\s\S]*next build --webpack/,
  );
  assert.match(isolated, /invocation_key=\$\{scratch##\*\.\}/);
  assert.match(isolated, /app-smoke\.Dockerfile/);
  assert.match(isolated, /runtime_image="ht-smoke-runtime-\$run_key"/);
  assert.match(isolated, /npm ci --ignore-scripts/);
  assert.match(isolated, /--name "\$install" --network "\$network"/);
  assert.match(isolated, /--https-proxy="\$HTTPS_PROXY"/);
  assert.match(isolated, /SMOKE_PROXY_TOKEN="\$proxy_token"/);
  assert.match(isolated, /docker network connect --alias registry-proxy/);
  assert.match(isolated, /node \/trusted\/fetch-prisma-smoke-engine\.mjs/);
  assert.match(isolated, /node \/trusted\/fetch-posthog-smoke-binary\.mjs/);
  assert.match(isolated, /--name "\$generate" --network "\$network"/);
  assert.doesNotMatch(isolated, /npm rebuild/);
  assert.match(
    isolated,
    /timeout --signal=KILL 2m env DATABASE_URL=.*prisma generate/,
  );
  assert.match(
    isolated,
    /diff -qr -- "\$candidate_root\/\$trusted_input" "\$trusted_root\/\$trusted_input"/,
  );
  assert.match(
    isolated,
    /\[ ! -e "\$candidate_root\/\$trusted_input" \] && \[ ! -e "\$trusted_root\/\$trusted_input" \]/,
  );
  assert.match(isolated, /use_trusted_dependencies=true/);
  assert.match(isolated, /dependencies_mount=\$trusted_root\/node_modules/);
  assert.match(isolated, /"\$dependencies_mount:\/app\/node_modules:ro"/);
  assert.match(isolated, /TURBOPUFFER_BASE_URL=http:\/\/"\$mock":3200/);
  assert.match(isolated, /GITHUB_ACTIONS="\$\{GITHUB_ACTIONS:-false\}"/);
  assert.match(isolated, /state="ht-smoke-state-/);
  assert.match(isolated, /-v "\$state:\/state:ro"/);
  assert.match(isolated, /\.\/node_modules\/\.bin\/prisma migrate deploy/);
  assert.match(
    isolated,
    /timeout --signal=KILL 2m \.\/node_modules\/\.bin\/prisma migrate deploy/,
  );
  assert.match(
    isolated,
    /timeout --signal=KILL 1m node \/trusted\/scripts\/seed-core-actions-smoke\.mjs/,
  );
  assert.match(isolated, /trap 'cleanup 130' INT/);
  assert.match(isolated, /trap 'cleanup 143' TERM/);
  assert.match(isolated, /CREATE ROLE core_smoke .* NOSUPERUSER/);
  assert.match(
    isolated,
    /PostgreSQL init process complete; ready for start up\./,
  );
  assert.match(
    isolated,
    /--tmpfs \/var\/lib\/postgresql\/data:rw,nosuid,nodev,size=1g/,
  );
  assert.match(isolated, /--name "\$seed"[\s\S]*CORE_SMOKE_APP_ROOT=\/trusted/);
  assert.match(seed, /writeFile\(/);
  assert.match(seed, /flag: "wx"/);
  assert.match(seed, /sections: \["Baseline", "Alternate"\]/);
  assert.match(seed, /section_title: "Baseline"/);
  assert.match(seed, /section_title: "Alternate"/);
  assert.match(isolated, /next build --webpack/);
  assert.match(isolated, /NODE_OPTIONS=--max-old-space-size=8192/);
  assert.match(isolated, /CORE_APP_SMOKE=true/);
  assert.match(
    isolated,
    /NEXT_FONT_GOOGLE_MOCKED_RESPONSES=\/trusted\/next-font-smoke-mock\.cjs/,
  );
  assert.match(isolated, /next start -p 3100/);
  assert.match(isolated, /signal: AbortSignal\.timeout\(5000\)/);
  assert.match(
    isolated,
    /node \/trusted\/scripts\/run-shared-core-actions-smoke\.mjs/,
  );
  assert.match(
    isolated,
    /--name "\$harness"[\s\S]*-v "\$trusted_root:\/trusted:ro"/,
  );
  assert.match(isolated, /--cap-drop ALL/);
  assert.match(isolated, /--security-opt no-new-privileges/);
  assert.match(isolated, /--read-only/);
  assert.match(isolated, /--log-opt max-size=10m/);
  assert.match(isolated, /--log-opt max-file=1/);
  assert.match(
    nextConfig,
    /webpackBuildWorker: process\.env\.CORE_APP_SMOKE === "true"/,
  );
  assert.match(
    nextConfig,
    /parallelServerBuildTraces: process\.env\.CORE_APP_SMOKE === "true"/,
  );
  assert.match(prismaEngine, /https:\/\/binaries\.prisma\.sh\/all_commits/);
  assert.match(prismaEngine, /actualChecksum !== expectedChecksum/);
  assert.match(npmProxy, /const registry = "registry\.npmjs\.org"/);
  assert.match(npmProxy, /request\.url !== allowedTarget/);
  assert.match(npmProxy, /net\.connect\(443, registry/);
});

test("auto-merge waits for app smoke and runs when it completes", async () => {
  const workflow = await readFile(".github/workflows/automerge.yml", "utf8");
  const ciWorkflow = await readFile(".github/workflows/ci-tests.yml", "utf8");

  assert.match(workflow, /workflows: \["CI Tests", "Revert Guard"\]/);
  assert.match(
    workflow,
    /REQUIRED="app-smoke ci-tests claude-review next-public-secrets revert-guard pr-title feature-flag-gate"/,
  );
  assert.match(ciWorkflow, /name: Verify live required-check settings/);
  assert.match(ciWorkflow, /default_branch.*gh api "repos\/\$REPO"/);
  assert.match(ciWorkflow, /name == "production-required-checks"/);
  assert.match(ciWorkflow, /\.target == "branch"/);
  assert.match(ciWorkflow, /index\("refs\/heads\/production"\)/);
  assert.match(ciWorkflow, /Live required checks do not match docs\/ci-policy\.yml/);
});

test("CI policy keeps the protected smoke producer live and required", async () => {
  const policy = yaml.load(await readFile("docs/ci-policy.yml", "utf8"));
  const required = [
    "app-smoke",
    "ci-tests",
    "claude-review",
    "pr-title",
    "revert-guard",
    "next-public-secrets",
    "secret-scan",
  ];

  assert.equal(policy.topology.repository_default_branch, "production");
  assert.deepEqual(policy.required_checks.contexts, required);
  assert.deepEqual(policy.required_checks.automerge_also_requires, [
    "app-smoke",
    "ci-tests",
  ]);
  assert.deepEqual(
    policy.policies.production_ruleset.required_status_checks,
    required,
  );
});

test("npm registry proxy refuses arbitrary CONNECT targets", async (t) => {
  const port = await startProxy(t);
  const response = await connectThroughProxy(port, "127.0.0.1:80");

  assert.match(response, /^HTTP\/1\.1 403 Forbidden/);
});

test("npm registry proxy requires authentication for the allowed target", async (t) => {
  const port = await startProxy(t);

  const response = await connectThroughProxy(port, "registry.npmjs.org:443");
  assert.match(response, /^HTTP\/1\.1 407 Proxy Authentication Required/);
  assert.match(response, /Proxy-Authenticate: Basic realm="smoke"/);
});
