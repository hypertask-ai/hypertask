#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import {
  collectApiRouteMethods,
  collectAiChatToolNames,
  collectHyperAiToolNames,
  collectMcpRegistryVariables,
} from "./parity-ai-chat-inventory.mjs";

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(options.root);
const contractPath = options.contract
  ? path.resolve(options.contract)
  : path.join(root, "config/parity/contract.json");
const inventoryPath = path.join(root, "config/parity/generated-inventory.json");
const reportPath = path.join(root, "docs/parity.md");

function parseArgs(argv) {
  const result = {
    mode: "check",
    cliCapabilities: null,
    baseline: null,
    candidateContract: null,
    candidateInventory: null,
    candidateReport: null,
    contract: null,
    root: process.cwd(),
    trustedCliPackage: null,
    trustedCliVersion: null,
    typescript: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--write") result.mode = "write";
    else if (value === "--check") result.mode = "check";
    else if (value === "--validate-only") result.mode = "validate-only";
    else if (value === "--cli-capabilities") {
      result.cliCapabilities = argv[index + 1];
      index += 1;
    } else if (value === "--root") {
      result.root = argv[index + 1];
      index += 1;
    } else if (value === "--contract") {
      result.contract = argv[index + 1];
      index += 1;
    } else if (value === "--baseline") {
      result.baseline = argv[index + 1];
      index += 1;
    } else if (value === "--candidate-contract") {
      result.candidateContract = argv[index + 1];
      index += 1;
    } else if (value === "--candidate-inventory") {
      result.candidateInventory = argv[index + 1];
      index += 1;
    } else if (value === "--candidate-report") {
      result.candidateReport = argv[index + 1];
      index += 1;
    } else if (value === "--trusted-cli-package") {
      result.trustedCliPackage = argv[index + 1];
      index += 1;
    } else if (value === "--trusted-cli-version") {
      result.trustedCliVersion = argv[index + 1];
      index += 1;
    } else if (value === "--typescript") {
      result.typescript = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function apiInventory() {
  const base = path.join(root, "src/app/api/mcp");
  const result = [];
  for (const file of walk(base).filter((entry) =>
    entry.endsWith("/route.ts"),
  )) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path
      .relative(base, path.dirname(file))
      .split(path.sep)
      .join("/");
    const route = `/api/mcp/${relative}`;
    const methods = collectApiRouteMethods(loadTypescript(), source, file);
    if (methods.length === 0) {
      throw new Error(
        `No HTTP method export found in ${path.relative(root, file)}`,
      );
    }
    for (const method of methods) result.push(`${method} ${route}`);
  }
  return result.sort();
}

function mcpInventory() {
  const toolsDirectory = path.join(root, "src/lib/mcp-server/tools");
  const registry = fs.readFileSync(
    path.join(toolsDirectory, "index.ts"),
    "utf8",
  );
  const metadata = fs.readFileSync(
    path.join(root, "src/lib/mcp-server/config/tool-metadata.ts"),
    "utf8",
  );
  const typescript = loadTypescript();
  const registeredTools = collectMcpRegistryVariables(
    typescript,
    registry,
    path.join(toolsDirectory, "index.ts"),
  );

  const names = registeredTools
    .map(({ variable, importedFrom }) => {
      const importedFile = `${importedFrom.slice(2)}.ts`;
      const source = fs.readFileSync(
        path.join(toolsDirectory, importedFile),
        "utf8",
      );
      const metadataKey = source.match(
        /name: TOOL_METADATA\.([A-Z0-9_]+)\.name/,
      )?.[1];
      if (!metadataKey)
        throw new Error(`No metadata key found for ${variable}`);
      const escaped = metadataKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const toolName = metadata.match(
        new RegExp(
          `${escaped}:\\s*\\{[\\s\\S]*?name: buildToolName\\('([^']+)'\\)`,
        ),
      )?.[1];
      if (!toolName)
        throw new Error(`No canonical name found for ${metadataKey}`);
      return `hypertask_${toolName}`;
    })
    .sort();
  if (new Set(names).size !== names.length) {
    throw new Error("MCP_TOOLS contains duplicate canonical tool names");
  }
  return names;
}

function loadTypescript() {
  const require = createRequire(import.meta.url);
  return require(
    options.typescript ? path.resolve(options.typescript) : "typescript",
  );
}

function aiChatInventory() {
  const file = path.join(root, "src/app/api/ai/chat/stream/route.ts");
  const source = fs.readFileSync(file, "utf8");
  const typescript = loadTypescript();
  return collectAiChatToolNames(typescript, source, file);
}

function flattenLeafCommands(commands, parents = []) {
  return commands.flatMap((command) => {
    const pathParts = [...parents, command.name];
    return command.commands?.length
      ? flattenLeafCommands(command.commands, pathParts)
      : [pathParts.join(" ")];
  });
}

function cliInventory(cliCapabilitiesPath, committedInventory) {
  if (!cliCapabilitiesPath) return committedInventory?.surfaces?.cli ?? [];
  const capabilities = JSON.parse(fs.readFileSync(cliCapabilitiesPath, "utf8"));
  if (!Array.isArray(capabilities.commands)) {
    throw new Error("CLI capabilities JSON has no commands array");
  }
  return flattenLeafCommands(capabilities.commands).sort();
}

function loadCommittedInventory() {
  return fs.existsSync(inventoryPath)
    ? JSON.parse(fs.readFileSync(inventoryPath, "utf8"))
    : null;
}

function collectInventory(cliCapabilitiesPath) {
  const mcp = mcpInventory();
  const adapter = fs.readFileSync(
    process.env.PARITY_HYPERAI_ADAPTER ??
      path.join(root, "src/app/api/ai/_lib/hyperAiTools.ts"),
    "utf8",
  );
  const hyperai = collectHyperAiToolNames(loadTypescript(), adapter, mcp);
  return {
    api: apiInventory(),
    mcp,
    cli: cliInventory(cliCapabilitiesPath, loadCommittedInventory()),
    ai_chat: aiChatInventory(),
    hyperai,
  };
}

function validateContract(
  contract,
  surfaces,
  { allowCompletedPlanned = options.mode === "validate-only" } = {},
) {
  const errors = [];
  const jobIds = new Set();
  for (const job of contract.jobs) {
    if (jobIds.has(job.id)) errors.push(`Duplicate job id: ${job.id}`);
    jobIds.add(job.id);
  }

  const assignments = {};
  for (const [surface, entries] of Object.entries(surfaces)) {
    assignments[surface] = {};
    for (const entry of entries) {
      const matchingJobs = contract.jobs.filter((job) =>
        (job.matches?.[surface] ?? []).some((pattern) =>
          new RegExp(pattern).test(entry),
        ),
      );
      if (matchingJobs.length !== 1) {
        errors.push(
          `${surface}: ${entry} matched ${matchingJobs.length} jobs` +
            (matchingJobs.length
              ? ` (${matchingJobs.map((job) => job.id).join(", ")})`
              : ""),
        );
      } else assignments[surface][entry] = matchingJobs[0].id;
    }

    for (const job of contract.jobs) {
      const hasEntry = Object.values(assignments[surface]).includes(job.id);
      const hasExclusion = Boolean(job.exclusions?.[surface]);
      const plannedTransition = job.planned?.[surface];
      const hasPlannedTransition = Boolean(plannedTransition);
      if (hasPlannedTransition) {
        const issue = plannedTransition.issue;
        const expires = plannedTransition.expires;
        const plannedEntries = plannedTransition.entries;
        if (
          typeof issue !== "string" ||
          !/^https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+$/.test(issue) ||
          typeof expires !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(expires) ||
          !Array.isArray(plannedEntries) ||
          plannedEntries.length === 0 ||
          plannedEntries.some((entry) => typeof entry !== "string" || !entry)
        ) {
          errors.push(
            `${job.id}: ${surface} planned transition requires an exact ticket URL, YYYY-MM-DD expiry, and concrete entries`,
          );
        } else {
          const expiry = new Date(`${expires}T23:59:59.999Z`);
          const latestAllowed = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          if (Number.isNaN(expiry.getTime()) || expiry < new Date()) {
            errors.push(`${job.id}: ${surface} planned transition expired on ${expires}`);
          } else if (expiry > latestAllowed) {
            errors.push(
              `${job.id}: ${surface} planned transition exceeds the 30-day limit`,
            );
          }
          for (const entry of plannedEntries) {
            const matchingJobs = contract.jobs.filter((candidate) =>
              (candidate.matches?.[surface] ?? []).some((pattern) =>
                new RegExp(pattern).test(entry),
              ),
            );
            if (matchingJobs.length !== 1 || matchingJobs[0].id !== job.id) {
              errors.push(
                `${job.id}: ${surface} planned entry ${entry} is not uniquely allowlisted to this job`,
              );
            }
          }
          const implementedPlannedEntries = plannedEntries.filter((entry) =>
            entries.includes(entry),
          );
          if (
            implementedPlannedEntries.length > 0 &&
            implementedPlannedEntries.length < plannedEntries.length
          ) {
            errors.push(
              `${job.id}: ${surface} planned entries must land together (${implementedPlannedEntries.length}/${plannedEntries.length} present)`,
            );
          } else if (
            implementedPlannedEntries.length === plannedEntries.length &&
            !allowCompletedPlanned
          ) {
            errors.push(
              `${job.id}: ${surface} planned entries are implemented; remove the transition`,
            );
          }
        }
      }
      if (!hasEntry && !hasExclusion && !hasPlannedTransition) {
        errors.push(
          `${job.id}: ${surface} has neither an implementation, exclusion, nor planned transition`,
        );
      }
      if (hasEntry && hasExclusion) {
        errors.push(
          `${job.id}: ${surface} has both an implementation and an exclusion`,
        );
      }
      if (hasExclusion && hasPlannedTransition) {
        errors.push(
          `${job.id}: ${surface} has both an exclusion and a planned transition`,
        );
      }
    }
  }
  if (errors.length) {
    throw new Error(
      `Parity contract validation failed:\n- ${errors.join("\n- ")}`,
    );
  }
  return assignments;
}

function generatedInventory(contract, surfaces, assignments) {
  return {
    generatedBy:
      "node scripts/parity-contract.mjs --write --cli-capabilities <file>",
    schemaVersion: contract.schemaVersion,
    cliPackage: contract.cliPackage,
    surfaces,
    assignments,
  };
}

function renderReport(contract, inventory) {
  const surfaceNames = ["api", "mcp", "cli", "ai_chat", "hyperai"];
  const header =
    ["Job", ...surfaceNames].map((value) => `| ${value} `).join("") + "|";
  const separator = `|${Array(header.split("|").length - 2)
    .fill("---")
    .join("|")}|`;
  const rows = contract.jobs.map((job) => {
    const cells = surfaceNames.map((surface) => {
      const count = Object.values(inventory.assignments[surface]).filter(
        (jobId) => jobId === job.id,
      ).length;
      if (count) {
        return job.planned?.[surface]
          ? `✅ ${count} (transition)`
          : `✅ ${count}`;
      }
      return job.planned?.[surface]
        ? `🛠 ${job.planned[surface].issue} by ${job.planned[surface].expires}`
        : `↪ ${job.exclusions[surface]}`;
    });
    return `| **${job.title}** | ${cells.join(" | ")} |`;
  });
  const counts = surfaceNames
    .map((surface) => `${surface}: ${inventory.surfaces[surface].length}`)
    .join(", ");
  return `# Five-surface parity\n\n**This generated contract enforces catalog coverage only.** It detects added, removed, or unmapped routes, tools, and CLI commands; it does not prove runtime authorization, mutation behavior, or confirmation policy. Those guarantees remain in implementation tests and review.\n\nThe first landing is bootstrapped by the pre-existing, exact-head \`claude-review\` required check plus manual sensitive-path merge. After landing, \`parity-contract-trusted\` evaluates candidate source with the verifier and policy from the protected base branch; PR code cannot replace or relax the rules judging that PR.\n\nRegenerate it with \`node scripts/parity-contract.mjs --write --cli-capabilities <production-capabilities.json>\`. Inventory: ${counts}. A number is the count of concrete routes, tools, or leaf commands implementing the canonical job. ↪ records an intentional exclusion; 🛠 is a reviewed, temporary two-step transition and must be removed by its implementation PR. The CLI inventory is pinned to \`${contract.cliPackage.name}@${contract.cliPackage.version}\`; HyperAI keys are independently validated as the identity projection of the canonical MCP registry.\n\n${header}\n${separator}\n${rows.join("\n")}\n`;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertSame(file, expected) {
  const actual = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (actual !== expected) {
    throw new Error(
      `${path.relative(root, file)} is stale. Run node scripts/parity-contract.mjs --write` +
        " with the production CLI capabilities file.",
    );
  }
}

function assertTrustedEntriesRemain(baseline, surfaces) {
  const removed = [];
  for (const [surface, entries] of Object.entries(baseline.surfaces ?? {})) {
    const candidateEntries = new Set(surfaces[surface] ?? []);
    for (const entry of entries) {
      if (!candidateEntries.has(entry)) removed.push(`${surface}: ${entry}`);
    }
  }
  if (removed.length) {
    throw new Error(
      `Trusted parity entries were removed:\n- ${removed.join("\n- ")}`,
    );
  }
}

function assertTrustedTransitionState(
  trustedContract,
  candidateContract,
  surfaces,
) {
  const errors = [];
  for (const trustedJob of trustedContract.jobs) {
    for (const [surface, transition] of Object.entries(
      trustedJob.planned ?? {},
    )) {
      const candidateJob = candidateContract.jobs.find(
        (job) => job.id === trustedJob.id,
      );
      const candidateTransition = candidateJob?.planned?.[surface];
      const completed = transition.entries.every((entry) =>
        (surfaces[surface] ?? []).includes(entry),
      );
      if (completed && candidateTransition) {
        errors.push(
          `${trustedJob.id}: ${surface} transition is complete and must be removed from the candidate contract`,
        );
      } else if (
        !completed &&
        JSON.stringify(candidateTransition) !== JSON.stringify(transition)
      ) {
        errors.push(
          `${trustedJob.id}: ${surface} transition changed before every trusted entry was implemented`,
        );
      }
    }
  }
  if (errors.length) {
    throw new Error(
      `Trusted parity transition validation failed:\n- ${errors.join("\n- ")}`,
    );
  }
}

function exactPatternForEntry(entry) {
  return `^${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

function assertTrustedContractEvolution(
  trustedContract,
  candidateContract,
  trustedCliPackage,
  trustedCliVersion,
) {
  const errors = [];
  const expectedCliPackage = {
    name: trustedCliPackage ?? trustedContract.cliPackage.name,
    version: trustedCliVersion ?? trustedContract.cliPackage.version,
  };
  if (
    candidateContract.schemaVersion !== trustedContract.schemaVersion ||
    candidateContract.title !== trustedContract.title
  ) {
    errors.push("top-level schema and title are immutable");
  }
  if (
    JSON.stringify(candidateContract.cliPackage) !==
    JSON.stringify(expectedCliPackage)
  ) {
    errors.push(
      `CLI package must match the trusted runner ${expectedCliPackage.name}@${expectedCliPackage.version}`,
    );
  }

  const trustedJobs = new Map(
    trustedContract.jobs.map((job) => [job.id, job]),
  );
  const candidateJobs = new Map(
    candidateContract.jobs.map((job) => [job.id, job]),
  );
  for (const id of trustedJobs.keys()) {
    if (!candidateJobs.has(id)) errors.push(`${id}: trusted job was removed`);
  }
  for (const id of candidateJobs.keys()) {
    if (!trustedJobs.has(id)) errors.push(`${id}: new jobs require a trusted policy update`);
  }

  for (const [id, trustedJob] of trustedJobs) {
    const candidateJob = candidateJobs.get(id);
    if (!candidateJob) continue;
    if (candidateJob.title !== trustedJob.title) {
      errors.push(`${id}: trusted title changed`);
    }

    const surfaces = new Set([
      ...Object.keys(trustedJob.matches ?? {}),
      ...Object.keys(candidateJob.matches ?? {}),
      ...Object.keys(trustedJob.exclusions ?? {}),
      ...Object.keys(candidateJob.exclusions ?? {}),
      ...Object.keys(trustedJob.planned ?? {}),
      ...Object.keys(candidateJob.planned ?? {}),
    ]);
    for (const surface of surfaces) {
      const trustedPatterns = trustedJob.matches?.[surface] ?? [];
      const candidatePatterns = candidateJob.matches?.[surface] ?? [];
      for (const pattern of trustedPatterns) {
        if (!candidatePatterns.includes(pattern)) {
          errors.push(`${id}: ${surface} trusted match pattern changed or was removed`);
        }
      }
      const addedPatterns = candidatePatterns.filter(
        (pattern) => !trustedPatterns.includes(pattern),
      );
      const trustedTransition = trustedJob.planned?.[surface];
      const candidateTransition = candidateJob.planned?.[surface];
      if (!trustedTransition && candidateTransition) {
        const expectedPatterns = candidateTransition.entries.map(
          exactPatternForEntry,
        );
        if (
          JSON.stringify([...addedPatterns].sort()) !==
          JSON.stringify([...expectedPatterns].sort())
        ) {
          errors.push(
            `${id}: ${surface} new transition must add one exact anchored pattern per planned entry`,
          );
        }
      } else if (addedPatterns.length) {
        errors.push(`${id}: ${surface} match patterns changed outside a new transition`);
      }

      const trustedExclusion = trustedJob.exclusions?.[surface];
      const candidateExclusion = candidateJob.exclusions?.[surface];
      if (candidateExclusion && candidateExclusion !== trustedExclusion) {
        errors.push(`${id}: ${surface} exclusion was added or changed`);
      }
      if (trustedExclusion && !candidateExclusion && !candidateTransition) {
        errors.push(`${id}: ${surface} exclusion was removed without a transition`);
      }
    }
  }

  if (errors.length) {
    throw new Error(
      `Trusted parity policy evolution failed:\n- ${errors.join("\n- ")}`,
    );
  }
}

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const surfaces = collectInventory(options.cliCapabilities);
const assignments = validateContract(contract, surfaces);
const inventory = generatedInventory(contract, surfaces, assignments);
const inventoryText = stableJson(inventory);
const reportText = renderReport(contract, inventory);

if (options.mode === "write") {
  fs.writeFileSync(inventoryPath, inventoryText);
  fs.writeFileSync(reportPath, reportText);
  console.log(
    `Wrote ${path.relative(root, inventoryPath)} and ${path.relative(root, reportPath)}`,
  );
} else if (options.mode === "check") {
  assertSame(inventoryPath, inventoryText);
  assertSame(reportPath, reportText);
  console.log("Five-surface parity contract is current");
} else {
  const baselinePath = path.resolve(
    options.baseline ?? path.join(path.dirname(contractPath), "generated-inventory.json"),
  );
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  assertTrustedEntriesRemain(baseline, surfaces);
  const candidateContract = JSON.parse(
    fs.readFileSync(
      path.resolve(options.candidateContract ?? contractPath),
      "utf8",
    ),
  );
  assertTrustedContractEvolution(
    contract,
    candidateContract,
    options.trustedCliPackage,
    options.trustedCliVersion,
  );
  assertTrustedTransitionState(contract, candidateContract, surfaces);
  const candidateAssignments = validateContract(candidateContract, surfaces, {
    allowCompletedPlanned: false,
  });
  const candidateInventory = generatedInventory(
    candidateContract,
    surfaces,
    candidateAssignments,
  );
  if (Boolean(options.candidateInventory) !== Boolean(options.candidateReport)) {
    throw new Error(
      "Trusted artifact validation requires both --candidate-inventory and --candidate-report",
    );
  }
  if (options.candidateInventory) {
    assertSame(
      path.resolve(options.candidateInventory),
      stableJson(candidateInventory),
    );
    assertSame(
      path.resolve(options.candidateReport),
      renderReport(candidateContract, candidateInventory),
    );
  }
  console.log("Five-surface parity source validates against the trusted contract");
}
