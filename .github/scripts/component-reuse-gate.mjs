import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const COMPONENT_REUSE_RULE =
  "Every PR that touches the UI must name the existing component it reuses for each new control.";

const COMPONENT_FILE = /^src\/components\/.*\.[jt]sx$/;
const COMPONENT_PATH = /^src\/components\/.*\.[cm]?[jt]sx?$/;
const UI_FILE = /^(?:src\/components\/|src\/(?:app|pages|features)\/(?!api\/)).*\.[jt]sx$/;
const INLINE_MENU = /(?:aria-haspopup\s*=\s*(?:["']menu["']|\{\s*["']menu["']\s*\})|role\s*=\s*(?:["']menu(?:item)?["']|\{\s*["']menu(?:item)?["']\s*\})|<(?:DropdownMenu|Menu)(?:[A-Z][A-Za-z]*|\s|>))/m;

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function changedPaths(baseSha, headSha, filter) {
  return git([
    "diff",
    "--name-only",
    "-z",
    `--diff-filter=${filter}`,
    `${baseSha}...${headSha}`,
  ]).split("\0").filter(Boolean);
}

function addedText(baseSha, headSha, path) {
  const diff = git([
    "diff",
    "--unified=0",
    "--no-ext-diff",
    `${baseSha}...${headSha}`,
    "--",
    path,
  ]);
  return diff.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function reuseSection(prBody) {
  const body = String(prBody ?? "");
  const heading = /^##[ \t]+Components reused[ \t]*$/im.exec(body);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const rest = body.slice(start);
  const nextHeading = /^##[ \t]+/m.exec(rest);
  return rest.slice(0, nextHeading?.index ?? rest.length)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

function declaredPaths(section) {
  if (!section) return [];
  return [...section.matchAll(/`(src\/components\/[^`\r\n]+\.[cm]?[jt]sx?)`/g)]
    .map((match) => match[1]);
}

function pathExistsOnBase(baseSha, path) {
  if (!COMPONENT_PATH.test(path) || path.includes("..") || path.includes("//")) return false;
  try {
    return git(["cat-file", "-t", `${baseSha}:${path}`]).trim() === "blob";
  } catch {
    return false;
  }
}

export function evaluateComponentReuse({ prBody, baseSha, headSha }) {
  const addedComponents = changedPaths(baseSha, headSha, "A").filter((path) => COMPONENT_FILE.test(path));
  const inlineMenus = changedPaths(baseSha, headSha, "AM").filter((path) =>
    UI_FILE.test(path) && INLINE_MENU.test(addedText(baseSha, headSha, path)),
  );
  const triggeringFiles = [...new Set([...addedComponents, ...inlineMenus])];

  if (triggeringFiles.length === 0) {
    return { pass: true, message: "No new component file or inline menu needs a reuse declaration." };
  }

  const section = reuseSection(prBody);
  if (!section) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} Add a non-empty "## Components reused" section for ${triggeringFiles.join(", ")}.`,
    };
  }

  const paths = declaredPaths(section);
  if (paths.length === 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} List each control with its reused \`src/components/...\` file path.`,
    };
  }

  const missing = [...new Set(paths)].filter((path) => !pathExistsOnBase(baseSha, path));
  if (missing.length > 0) {
    return {
      pass: false,
      message: `${COMPONENT_REUSE_RULE} These named components do not exist on the base branch: ${missing.join(", ")}.`,
    };
  }

  return {
    pass: true,
    message: `Components reused: ${[...new Set(paths)].join(", ")}.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [bodyFile, baseSha, headSha] = process.argv.slice(2);
  if (!bodyFile || !baseSha || !headSha) {
    console.error("usage: component-reuse-gate.mjs <pr-body-file> <base-sha> <head-sha>");
    process.exit(2);
  }
  try {
    const result = evaluateComponentReuse({
      prBody: readFileSync(bodyFile, "utf8"),
      baseSha,
      headSha,
    });
    console.log(result.message);
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
