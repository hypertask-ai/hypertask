const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

function major(version, label) {
  const match = (typeof version === "string" || typeof version === "number")
    && /^(?:[v^~])?(\d+)(?:\.(?:\d+|x)(?:\.(?:\d+|x))?)?$/.exec(String(version));
  if (!match) throw new Error(`${label} must pin a single Node major; got ${JSON.stringify(version ?? null)}`);
  return Number(match[1]);
}

function workflowNodeVersions(content) {
  const versions = [];
  const workflow = yaml.load(content, { schema: yaml.JSON_SCHEMA });
  for (const [job, config] of Object.entries(workflow?.jobs ?? {})) {
    for (const [index, step] of (config.steps ?? []).entries()) {
      for (const [key, value] of Object.entries(step.with ?? {})) {
        if (key === "node-version" || key === "node-version-file") {
          versions.push({ key, value, location: `workflow.jobs.${job}.steps.${index}.with.${key}` });
        }
      }
    }
  }
  return versions;
}

function compareNodeVersions(liveVersion, engine, workflows) {
  const expected = major(liveVersion, "Vercel nodeVersion");
  const issues = [];
  function compare(value, label) {
    try {
      if (major(value, label) !== expected) issues.push(`${label} is ${value}, but live Vercel nodeVersion is ${liveVersion}`);
    } catch (error) {
      issues.push(error.message);
    }
  }
  compare(engine, "package.json engines.node");
  for (const { file, content } of workflows) {
    for (const entry of workflowNodeVersions(content)) {
      const label = `${file} ${entry.location}`;
      if (entry.key === "node-version-file") issues.push(`${label}: use an explicit node-version so its major can be compared with Vercel`);
      else compare(entry.value, label);
    }
  }
  return issues;
}

if (require.main === module) {
  try {
    const liveVersion = fs.readFileSync(process.argv[2], "utf8").trim();
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const workflows = fs.readdirSync(".github/workflows").filter((file) => /\.ya?ml$/.test(file)).map((file) => ({
      file,
      content: fs.readFileSync(path.join(".github/workflows", file), "utf8"),
    }));
    const issues = compareNodeVersions(liveVersion, pkg.engines?.node, workflows);
    if (issues.length) throw new Error(issues.join("\n"));
    console.log(`Node version guard passed: package.json and all workflow pins match live Vercel ${liveVersion}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { compareNodeVersions, workflowNodeVersions };
