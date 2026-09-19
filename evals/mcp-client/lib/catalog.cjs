"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CLIENTS = ["claude", "cursor", "codex"];
const TRANSPORTS = ["mcp", "cli"];

function catalogPath() {
  return path.join(__dirname, "..", "tasks.json");
}

function loadCatalog(filePath = catalogPath()) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw.tasks) || raw.tasks.length !== 20) {
    throw new Error(
      `Eval catalog must contain exactly 20 tasks, got ${raw.tasks?.length ?? 0}`,
    );
  }
  const ids = new Set();
  for (const task of raw.tasks) {
    if (!task.id || !task.prompt) {
      throw new Error("Every task needs an id and a prompt");
    }
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (!Array.isArray(task.mcp?.tools) || task.mcp.tools.length === 0) {
      throw new Error(`${task.id} is missing an MCP tool plan`);
    }
    if (!Array.isArray(task.cli?.commands) || task.cli.commands.length === 0) {
      throw new Error(`${task.id} is missing a CLI command plan`);
    }
    for (const tool of task.mcp.tools) {
      if (!String(tool.name || "").startsWith("hypertask_")) {
        throw new Error(`${task.id} MCP tool ${tool.name} is not a Hypertask tool`);
      }
    }
    for (const command of task.cli.commands) {
      if (!Array.isArray(command.argv) || command.argv.length === 0) {
        throw new Error(`${task.id} CLI command is empty`);
      }
    }
    const expect = task.expect || {};
    if (!Array.isArray(expect.stdoutIncludes) || expect.stdoutIncludes.length === 0) {
      throw new Error(`${task.id} is missing expect.stdoutIncludes`);
    }
  }
  assertCatalogToolsAreInProduct(raw.tasks);
  return raw;
}

function assertCatalogToolsAreInProduct(tasks) {
  const metadataPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "src",
    "lib",
    "mcp-server",
    "config",
    "tool-metadata.ts",
  );
  const metadata = fs.readFileSync(metadataPath, "utf8");
  for (const task of tasks) {
    for (const tool of task.mcp.tools) {
      const suffix = String(tool.name || "").replace(/^hypertask_/, "");
      if (!metadata.includes(`buildToolName('${suffix}')`)) {
        throw new Error(
          `${task.id} uses ${tool.name}, which is not in the production MCP tool registry`,
        );
      }
    }
  }
}

module.exports = {
  CLIENTS,
  TRANSPORTS,
  catalogPath,
  loadCatalog,
};
