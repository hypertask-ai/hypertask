import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALL = "all";
export const NONE = "none";
export const SELECTED = "selected";
export const EMPTY_SELECTION = "empty";
export const emptySelectionMessage = "selected test list is empty; refusing to skip the suite";

export function planShardInput({ eventName, buildNeeded, selectedText }) {
  if (eventName !== "pull_request") return ALL;
  if (buildNeeded !== "true") return NONE;
  const files = String(selectedText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (files.includes("ALL")) return ALL;
  return files.length > 0 ? SELECTED : EMPTY_SELECTION;
}

function readSelection(root) {
  try {
    return readFileSync(path.join(root, "selected-tests.txt"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

const invokedDirectly = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const mode = planShardInput({
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    buildNeeded: process.env.BUILD_NEEDED ?? "",
    selectedText: readSelection(process.env.RUNNER_TEMP ?? process.cwd()),
  });
  if (mode === EMPTY_SELECTION) {
    console.error(emptySelectionMessage);
    process.exit(1);
  }
  process.stdout.write(`${mode}\n`);
}
