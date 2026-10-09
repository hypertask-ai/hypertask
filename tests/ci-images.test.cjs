const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const test = require("node:test");
const yaml = require("js-yaml");

const source = (path) => readFileSync(path, "utf8");
const workflow = (name) => yaml.load(source(`.github/workflows/${name}.yml`));
const images = JSON.parse(source(".github/ci-images.json"));
const reference = ({ image, tag, digest }) => `ghcr.io/hypertask-ai/ci-${image}:${tag}@${digest}`;
const token = "${{ github.token }}";
const actor = "${{ github.actor }}";

function assertService(service, job) {
  assert.ok(images.some((image) => reference(image) === service.image), service.image);
  assert.equal(job.permissions.packages, "read");
  assert.deepEqual(service.credentials, { username: actor, password: token });
}

function assertLoginBefore(job, stepName) {
  const pullIndex = job.steps.findIndex((step) => step.name === stepName);
  assert.ok(pullIndex >= 0);
  const loginIndex = job.steps.findIndex((step) => step.uses?.startsWith("docker/login-action@"));
  assert.ok(loginIndex >= 0 && loginIndex < pullIndex);
  assert.deepEqual(job.steps[loginIndex].with, { registry: "ghcr.io", username: actor, password: token });
  assert.equal(job.permissions.packages, "read");
  assert.equal(job.steps[loginIndex].if, job.steps[pullIndex].if);
}

test("every CI service and command-line consumer uses a pinned GHCR copy with read-only authentication", () => {
  let services = 0;
  for (const file of readdirSync(".github/workflows").filter((file) => /\.ya?ml$/.test(file))) {
    const parsed = yaml.load(source(`.github/workflows/${file}`));
    for (const job of Object.values(parsed.jobs)) {
      for (const service of Object.values(job.services || {})) {
        assertService(service, job);
        services++;
      }
      if (job.container) assertService(job.container, job);
    }
  }
  assert.ok(services > 0, "service inventory must not be vacuous");
  const ci = workflow("ci-tests").jobs["ci-tests"];
  assert.equal(ci.env.HTPR_PG_IMAGE, reference(images.find((image) => image.tag === "16-alpine")));
  assertLoginBefore(ci, "Pull PostgreSQL test image");
  const smoke = workflow("app-smoke").jobs["app-smoke"];
  assertLoginBefore(smoke, "Build and test the candidate in disposable containers");
  const dockerfile = source("scripts/app-smoke.Dockerfile");
  assert.equal(dockerfile.split("\n")[0], `FROM ${reference(images.find((image) => image.image === "node"))}`);
  const isolated = source("scripts/run-app-smoke-isolated.sh");
  assert.ok(isolated.includes(reference(images.find((image) => image.tag === "16-bookworm"))));
  for (const path of [".github/workflows/ci-tests.yml", "scripts/app-smoke.Dockerfile", "scripts/run-app-smoke-isolated.sh"]) {
    assert.doesNotMatch(source(path), /public\.ecr\.aws|quay\.io\/soketi/);
  }
  // Local-only defaults are allowed, but every PostgreSQL Docker test must honor CI's override.
  for (const file of readdirSync("tests").filter((file) => file.endsWith(".test.cjs"))) {
    const text = source(`tests/${file}`);
    if (/^const .+require\("node:child_process"\)/m.test(text) && text.includes('"postgres:16-alpine"')) assert.match(text, /process\.env\.HTPR_PG_IMAGE \|\| "postgres:16-alpine"/, file);
  }
});

test("CI image assertions reject anonymous sources, missing credentials, and login after pulls", () => {
  const service = workflow("ci-tests").jobs["browser-smoke"].services.postgres;
  const job = workflow("ci-tests").jobs["browser-smoke"];
  assert.throws(() => assertService({ ...service, image: service.image.replace("ghcr.io/hypertask-ai/ci-", "public.ecr.aws/docker/library/") }, job));
  assert.throws(() => assertService({ ...service, credentials: undefined }, job));
  assert.throws(() => assertService(service, { ...job, permissions: { contents: "read" } }));
  const cli = workflow("ci-tests").jobs["ci-tests"];
  const steps = [...cli.steps];
  const login = steps.splice(steps.findIndex((step) => step.uses?.startsWith("docker/login-action@")), 1)[0];
  steps.push(login);
  assert.throws(() => assertLoginBefore({ ...cli, steps }, "Pull PostgreSQL test image"));
});

test("weekly and dispatch mirror preserves official pinned digests and proves repository package access", () => {
  const copy = workflow("ci-images");
  assert.ok(Object.hasOwn(copy.on, "workflow_dispatch"));
  assert.equal(copy.on.schedule[0].cron, "23 4 * * 1");
  assert.deepEqual(copy.on.push.branches, ["yper4-231-ghcr-ci-images"]);
  assert.deepEqual(copy.permissions, {});
  assert.equal(copy.jobs.mirror.permissions.packages, "write");
  assert.equal(copy.jobs["verify-read"].permissions.packages, "read");
  assert.deepEqual(copy.jobs["verify-read"].needs, ["inventory", "mirror"]);
  assert.equal(copy.jobs.mirror.strategy["max-parallel"], 1);
  for (const jobName of ["mirror", "verify-read"]) {
    const login = copy.jobs[jobName].steps.find((step) => step.uses?.startsWith("docker/login-action@"));
    assert.equal(login.with.password, token);
    assert.equal(login.with.registry, "ghcr.io");
  }
  const builder = copy.jobs.mirror.steps.find((step) => step.uses?.startsWith("docker/setup-buildx-action@"));
  assert.equal(builder.with.driver, "docker", "do not pull an extra BuildKit image");
  const run = copy.jobs.mirror.steps.find((step) => step.name === "Copy the pinned official manifest without rebuilding").run;
  assert.match(run, /imagetools create --prefer-index=false --tag "\$DESTINATION" "\$SOURCE"/);
  assert.match(run, /imagetools inspect --raw "\$DESTINATION" \| sha256sum/);
  assert.match(run, /\[ "\$actual" = "\$DIGEST" \] \|\| .*exit 1/);
  assert.equal(copy.jobs["verify-read"].steps.at(-1).run, 'docker pull "$IMAGE"');
  assert.deepEqual(images.map(({ image, tag }) => `${image}:${tag}`).sort(), ["node:22-bookworm", "postgres:16-alpine", "postgres:16-bookworm", "redis:7-alpine", "soketi:1.6-16-alpine"]);
  for (const image of images) {
    assert.match(image.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(image.source, image.image === "soketi" ? "quay.io/soketi/soketi" : `docker.io/library/${image.image}`);
  }
});

test("trusted smoke keeps registry credentials outside candidate containers and documents explicit recovery", () => {
  const smoke = workflow("app-smoke").jobs["app-smoke"];
  assert.equal(smoke.steps[0].with.ref, "${{ github.sha }}");
  assert.equal(smoke.steps[1].with.path, "candidate");
  const run = source("scripts/run-app-smoke-isolated.sh");
  assert.doesNotMatch(run, /GITHUB_TOKEN|GH_TOKEN|github\.token|\.docker\/config|DOCKER_CONFIG/);
  assert.match(run, /--cap-drop ALL/);
  assert.match(run, /docker network create --internal/);
  const readme = source("e2e/smoke/README.md");
  assert.match(readme, /There is no automatic fallback/);
  assert.match(readme, /Fallback for a GHCR outage/);
  assert.match(readme, /all five read-only pulls, before merging/);
});
