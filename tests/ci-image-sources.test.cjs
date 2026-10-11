const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const images = JSON.parse(readFileSync(path.join(root, ".github/ci-images.json"), "utf8"));
const reference = ({ image, tag, digest }) => `ghcr.io/hypertask-ai/ci-${image}:${tag}@${digest}`;
const ecr = ["public", "ecr", "aws"].join(".");
const hub = ["docker", "io"].join(".");
const quay = ["quay", "io/soketi/soketi"].join(".");
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const forbidden = new RegExp(
  `(?:${escape(ecr)}|${escape(hub)}|${escape(quay)})[^\\s"'\x60<>]*|(?<![a-z0-9_/-])(?:postgres|redis|node|soketi):(?:[0-9][a-z0-9_.-]*|latest)\\b`,
  "gi",
);

function assertSources(file, text) {
  // The mirror must read upstream registries, but consumers must never do so.
  if (file === ".github/ci-images.json") {
    text = JSON.stringify(JSON.parse(text).map(({ source, ...image }) => image));
  }
  const violations = [...text.matchAll(forbidden)].map((match) => {
    const image = images.find(({ image, tag }) => match[0].includes(`${image}:${tag}`))
      || images.find(({ image }) => new RegExp(`(?:^|/)${image}(?=:|$)`).test(match[0]));
    const replacement = image ? reference(image) : images.map(reference).join(", ");
    const line = text.slice(0, match.index).split("\n").length;
    return `${file}:${line}: ${match[0]} must use ${replacement}`;
  });
  assert.equal(violations.length, 0, violations.join("\n"));
}

function filesIn(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".state", ".cache", ".git", "__pycache__"].includes(entry.name)) return [];
      return filesIn(file);
    }
    return entry.isFile() ? [file] : [];
  });
}

test("all CI directories and CI Compose files use our GHCR images", () => {
  const files = ["tests", "e2e", "scripts", ".github"].flatMap(filesIn);
  // The root docker-compose.yml is a local-only PostgreSQL 14 stack, not used by CI.
  const compose = readdirSync(root).filter((file) => /^(?:docker-)?compose.*\.ya?ml$/.test(file) && file !== "docker-compose.yml");
  files.push(...compose);
  for (const directory of ["tests/", "e2e/", "scripts/", ".github/"]) {
    assert.ok(files.some((file) => file.startsWith(directory)), `Missing CI inventory: ${directory}`);
  }
  for (const file of files) assertSources(file, readFileSync(path.join(root, file), "utf8"));
});

test("guard rejects registry and bare image regressions with the seeded GHCR replacement", () => {
  for (const image of images) {
    const bare = `${image.image}:${image.tag}`;
    for (const source of [bare, `${hub}/library/${bare}`, `${ecr}/docker/library/${bare}`,
      ...(image.image === "soketi" ? [`${quay}:${image.tag}`] : [])]) {
      for (const file of ["tests/nested/fixture.ts", "e2e/fixture.sh", "scripts/fixture.Dockerfile", ".github/workflows/fixture.yml", "docker-compose.ci.yml"]) {
        assert.throws(() => assertSources(file, `image: ${source}`), (error) => {
          assert.ok(error.message.includes(`${file}:1`));
          assert.ok(error.message.includes(reference(image)));
          return true;
        });
      }
    }
    assertSources("scripts/fixture.sh", `docker run ${reference(image)}`);
  }
  assertSources("tests/fixture.cjs", 'require("node:assert/strict"); const redis = { host: "localhost" };');
  assertSources(".github/ci-images.json", JSON.stringify(images));
  assert.throws(() => assertSources(".github/consumer.json", JSON.stringify(images)));
});
