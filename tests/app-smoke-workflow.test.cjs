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
  assert.deepEqual(parsedWorkflow.concurrency, {
    group: "${{ github.event_name == 'push' && 'app-smoke-production-cache' || format('app-smoke-run-{0}', github.run_id) }}",
    "cancel-in-progress": true,
  });
  assert.equal(parsedWorkflow.jobs["app-smoke"].concurrency, undefined);
  assert.deepEqual(parsedWorkflow.on.push.branches, ["production"]);
  assert.deepEqual(yaml.load(request).concurrency, {
    group: "app-smoke-request-${{ github.event.pull_request.number }}",
    "cancel-in-progress": true,
  });
  const validationSteps = parsedWorkflow.jobs.validate.steps;
  const recheck = validationSteps.find((step) => step.id === "current-request");
  assert.ok(validationSteps.indexOf(recheck) > validationSteps.findIndex((step) => step.id === "scope"));
  assert.match(recheck.with.script, /if \(!await currentHead\(\)\) return;/);
  assert.match(recheck.with.script, /requestNumber < request\.run_number/);
  assert.match(recheck.with.script, /requestNumber === request\.run_number && run\.run_number < context\.runNumber/);
  assert.ok(recheck.with.script.lastIndexOf("if (!await currentHead()) return;") < recheck.with.script.indexOf("await client.rest.actions.cancelWorkflowRun("));
  assert.match(recheck.with.script, /new github.constructor\(\{ auth: process.env.GH_FALLBACK_TOKEN \}\)/);
  assert.match(recheck.with.script, /Could not cancel older app-smoke runs; continuing the build/);
  assert.equal(parsedWorkflow.jobs.validate.concurrency, undefined);
  assert.equal(parsedWorkflow.jobs.report.concurrency, undefined);
  assert.equal(
    parsedWorkflow.jobs.validate.if,
    "github.event_name == 'workflow_run' && github.event.workflow_run.conclusion != 'cancelled'",
  );
  assert.equal(
    parsedWorkflow.jobs.report.if,
    "always() && !cancelled() && github.event_name == 'workflow_run' && github.event.workflow_run.conclusion != 'cancelled' && needs.validate.outputs.superseded != 'true'",
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
  assert.match(workflow, /node-version: \^24\.\d+\.\d+/);
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
  const parsedSmoke = JSON.parse(workflowJson);
  for (const [id, job] of Object.entries(parsedSmoke.jobs)) {
    const steps = id === "validate" ? job.steps.filter((step) => step.id !== "ci-token") : job.steps;
    assert.doesNotMatch(JSON.stringify({ ...job, steps }), /\"secrets\"\s*:|\bsecrets\s*(?:\.|\[)/, id);
  }
  const ciToken = parsedSmoke.jobs.validate.steps.find((step) => step.id === "ci-token");
  assert.match(ciToken.uses, /^actions\/create-github-app-token@[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(ciToken.with).filter((key) => /secrets/.test(ciToken.with[key])), ["app-id", "private-key"]);
  assert.equal(ciToken.with["app-id"], "${{ secrets.CI_APP_ID }}");
  assert.equal(ciToken.with["private-key"], "${{ secrets.CI_APP_PRIVATE_KEY }}");
  assert.equal(parsedSmoke.jobs.validate.steps.some((step) => step.with?.repository || /candidate/.test(step.with?.path || "")), false);

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
  assert.match(
    isolated,
    /--name "\$seed"[\s\S]*"\$\{database_client_mounts\[@\]\}"/,
  );
  assert.match(
    isolated,
    /-v "\$scratch\/candidate-client\/\.prisma:\/trusted\/node_modules\/\.prisma:ro"/,
  );
  assert.match(
    isolated,
    /-v "\$scratch\/candidate-client\/@prisma:\/trusted\/node_modules\/@prisma:ro"/,
  );
  assert.match(isolated, /\[ "\$dependencies_mount" != "\$trusted_root\/node_modules" \]/);
  assert.match(
    isolated,
    /mkdir -p "\$scratch\/candidate-client"[\s\S]*?chmod 0777 "\$scratch\/candidate-client"[\s\S]*?docker run --rm --name "\$\{generate\}-client"/,
  );
  assert.match(isolated, /-v "\$dependencies_mount:\/dependencies:ro"/);
  assert.match(
    isolated,
    /for generated_client in \.prisma @prisma; do/,
  );
  assert.match(
    isolated,
    /cp -a --no-preserve=ownership "\/dependencies\/\$generated_client" \/out\//,
  );
  assert.match(
    isolated,
    /for generated_client in \.prisma @prisma; do[\s\S]*?chmod -R a\+rwX "\/out\/\$generated_client"/,
  );
  assert.match(
    isolated,
    /Generated Prisma client missing from the candidate dependencies\./,
  );
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
  assert.match(nextConfig, /webpackBuildWorker: true/);
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

  assert.match(workflow, /workflows: \["CI Tests", "Revert Guard"\]/);
  assert.match(
    workflow,
    /REQUIRED="app-smoke ci-tests ai-review next-public-secrets pr-title"/,
  );
  assert.match(workflow, /REQUIRED="\$REQUIRED feature-flag-gate"/);
  assert.match(workflow, /REQUIRED="\$REQUIRED browser-smoke"/);
});

test("required-check drift monitoring is hourly, production-only and outside PR CI", async () => {
  const ciWorkflow = await readFile(".github/workflows/ci-tests.yml", "utf8");
  const ciSteps = yaml.load(ciWorkflow).jobs["ci-prepare"].steps;
  assert.doesNotMatch(JSON.stringify(ciSteps), /secrets\.CI_APP_(?:ID|PRIVATE_KEY)/);
  assert.equal(ciSteps.some((step) => step.run?.includes("verify-required-check-settings.mjs")), false);
  const settingsWorkflow = yaml.load(await readFile(".github/workflows/required-check-settings.yml", "utf8"));
  assert.deepEqual(Object.keys(settingsWorkflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(settingsWorkflow.on.schedule, [{ cron: "17 * * * *" }]);
  assert.deepEqual(settingsWorkflow.permissions, { contents: "read" });
  assert.equal(settingsWorkflow.concurrency["cancel-in-progress"], false);
  const settingsJob = settingsWorkflow.jobs.verify;
  assert.equal(settingsJob.if, "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/production')");
  assert.equal(settingsJob["runs-on"], "ubuntu-latest");
  assert.equal(settingsJob["timeout-minutes"], 80);
  const steps = settingsJob.steps;
  const settingsIndex = steps.findIndex((step) => step.name === "Verify live required-check settings");
  const settingsStep = steps[settingsIndex];
  assert.equal(settingsStep.run, "node .github/scripts/verify-required-check-settings.mjs");
  assert.equal(settingsStep.if, undefined);
  assert.equal(settingsStep["continue-on-error"], undefined);
  assert.equal(settingsStep["timeout-minutes"], 70);
  assert.equal(settingsStep.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(settingsStep.env.REPO, "${{ github.repository }}");
  assert.match(steps[0].uses, /^actions\/checkout@/);
  assert.equal(steps[0].with.ref, "production");
  assert.equal(steps[0].with["persist-credentials"], false);
  assert.ok(settingsIndex > 0);
  assert.equal(settingsStep.id, "verify");
  assert.equal(settingsStep.env.SETTINGS_PROOF, ".settings-proof/last-verified.json");
  const restoreProof = steps[settingsIndex - 1];
  assert.match(restoreProof.uses, /^actions\/cache\/restore@[0-9a-f]{40}/);
  assert.deepEqual(restoreProof.with, {
    path: ".settings-proof",
    key: "required-check-settings-proof-${{ github.run_id }}",
    "restore-keys": "required-check-settings-proof-",
  });
  const saveProof = steps[settingsIndex + 1];
  assert.match(saveProof.uses, /^actions\/cache\/save@[0-9a-f]{40}/);
  assert.equal(saveProof.if, "steps.verify.outputs.verified == 'true'");
  assert.deepEqual(saveProof.with, {
    path: ".settings-proof",
    key: "required-check-settings-proof-${{ github.run_id }}",
  });
  assert.equal(steps.length, settingsIndex + 2);
  const settingsScript = await readFile(".github/scripts/verify-required-check-settings.mjs", "utf8");
  assert.match(settingsScript, /GITHUB_EVENT_NAME !== "pull_request"/);
  assert.match(settingsScript, /"fetch", "--no-tags", "--depth=1", "origin", base, head/);
  assert.match(settingsScript, /"diff", "--name-only", "--no-renames", "-z", base, head/);
  assert.match(settingsScript, /file\.startsWith\("\.github\/"\)/);
  assert.match(settingsScript, /file === "docs\/ci-policy\.yml"/);
  assert.match(settingsScript, /file === "docs\/ci\.md"/);
  assert.match(settingsScript, /changed files unknown; verifying \(fail-closed\)/);
  assert.match(settingsScript, /skipping settings API reads/);
  assert.match(settingsScript, /"api", "--include", endpoint/);
  assert.match(settingsScript, /x-ratelimit-reset/);
  assert.match(settingsScript, /retry-after/);
  assert.match(settingsScript, /status === 403 \|\| status === 429/);
  assert.match(settingsScript, /maxWaitSeconds = 3900/);
  assert.match(settingsScript, /waitedSeconds \+ seconds > maxWaitSeconds/);
  assert.match(settingsScript, /rate limited, waiting \$\{seconds\}s until reset/);
  assert.match(settingsScript, /spawnSync\("sleep"/);
  assert.match(settingsScript, /process\.exitCode = 1/);
  assert.match(settingsScript, /SETTINGS_PROOF/);
  assert.match(settingsScript, /last-verified\.json/);
  assert.match(settingsScript, /::warning::Required-check settings were not verified this run/);
  assert.match(settingsScript, /Required-check settings: not verified this run\./);
  assert.match(settingsScript, /Last verified settings: none stored/);
  assert.match(settingsScript, /if \(error\.rateLimited\) \{\s*reportRateLimitRefusal\(error\);\s*\} else \{/);
  const refusalBody = settingsScript.slice(settingsScript.indexOf("function reportRateLimitRefusal"),
    settingsScript.indexOf("\ntry {"));
  assert.ok(refusalBody.length > 0, "refusal reporter is missing");
  assert.doesNotMatch(refusalBody, /exitCode = 1/);
  assert.match(settingsScript, /repository\.default_branch !== "production"/);
  assert.match(settingsScript, /ruleset\.name === "production-required-checks" && ruleset\.enforcement === "active"/);
  assert.match(settingsScript, /matches\.length !== 1/);
  assert.match(settingsScript, /ruleset\.target !== "branch"/);
  assert.match(settingsScript, /!ruleset\.conditions\.ref_name\.include\.includes\("refs\/heads\/production"\)/);
  assert.match(settingsScript, /ruleset\.conditions\.ref_name\.exclude\.includes\("refs\/heads\/production"\)/);
  assert.match(settingsScript, /new Set\(ruleset\.rules/);
  assert.match(settingsScript, /Live required checks do not match docs\/ci-policy\.yml/);
  const contexts = settingsScript.match(/const expected = \[([\s\S]*?)\]\.sort\(\)/)[1];
  assert.deepEqual(
    [...contexts.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]).sort(),
    yaml.load(await readFile("docs/ci-policy.yml", "utf8")).required_checks.contexts.sort(),
  );
});

test("CI policy keeps the protected smoke producer live and required", async () => {
  const policy = yaml.load(await readFile("docs/ci-policy.yml", "utf8"));
  const required = [
    "app-smoke",
    "browser-smoke",
    "ci-tests",
    "ai-review",
    "claude-review",
    "feature-flag-gate",
    "pr-title",
    "next-public-secrets",
    "secret-scan",
    "premerge-evidence",
  ];

  assert.equal(policy.topology.repository_default_branch, "production");
  assert.deepEqual(policy.required_checks.contexts, required);
  assert.deepEqual(policy.required_checks.automerge_also_requires, [
    "app-smoke",
    "browser-smoke",
    "ci-tests",
    "feature-flag-gate",
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
