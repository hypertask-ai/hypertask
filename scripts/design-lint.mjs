#!/usr/bin/env node
/**
 * design-lint: deterministic half of the design gate.
 *
 * Reads the added lines of a diff and fails on styling the Hypertask style
 * guide forbids. The rules come from docs/design/STYLE-GUIDE.md, which defers
 * to openwiki/style-guide.md for anything it does not restate.
 *
 * It lints CHANGED LINES, never whole files. openwiki/style-guide.md says a
 * style finding gates only when the diff itself proves the pull request
 * introduced or materially extended the violation, and that unchanged
 * historical drift must not gate. A file-scoped lint would make every legacy
 * component unmergeable, so this walks the `+` lines of the diff only.
 *
 * Usage:
 *   node scripts/design-lint.mjs                       # working tree vs merge-base with production
 *   node scripts/design-lint.mjs --base <ref-or-sha>   # explicit base
 *   node scripts/design-lint.mjs --base <sha> --head <sha>
 *   node scripts/design-lint.mjs --json                # machine-readable findings
 *   node scripts/design-lint.mjs --verify-tokens       # docs/design/tokens.json vs tailwind.config.ts
 *
 * Exit codes: 0 clean, 1 violations found, 2 could not evaluate.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const ALLOW_FILE = path.join(REPO_ROOT, "docs/design/lint-allow.txt");
const TOKENS_FILE = path.join(REPO_ROOT, "docs/design/tokens.json");
const TAILWIND_CONFIG = path.join(REPO_ROOT, "tailwind.config.ts");

/** Files whose changed lines are linted. */
const LINTED = /^src\/.*\.(tsx|jsx|css|scss)$/;

/**
 * Theme and token definition files. They are where raw colour values are
 * supposed to live, so colour rules do not apply to them.
 */
const TOKEN_SOURCES = [
  /^src\/styles\/tailwindThemes\//,
  /^src\/styles\/globals\.scss$/,
];

/** Brand tokens declared in openwiki/style-guide.md. Allowed as literals. */
const BRAND_LITERALS = new Set([
  "#4455bb", // hypertasks-purple
  "#c2cfa5", // hypertasks-green
  "#c668ff", // hypertasks-ai-purple
  "#2383e2", // hypertasks-header-blue
]);

/** Radii the guide sanctions. Dia's 10px/12px stay scoped to .dia themes. */
const ALLOWED_ARBITRARY_RADII = new Set([0, 2, 4, 5]);

/** Named font-size utilities from tailwind.config.ts (HTPR-4215 scale). */
const NAMED_TEXT_SIZES = [
  "text-micro",
  "text-meta",
  "text-dense",
  "text-content",
  "text-emphasis",
  "text-subheading",
  "text-heading",
  "text-display",
];

/**
 * Spacing: Tailwind's base unit is 4px, and the guide permits 2px and 6px half
 * steps for compact internal alignment. Everything else is off-scale.
 */
function spacingIsOnScale(px) {
  return px === 2 || px === 6 || px % 4 === 0;
}

const SPACING_PREFIX = "(?:p|m|gap|space-[xy]|inset)[trblxyse]?";

/** Inline-style object keys that carry colour or spacing. */
const INLINE_STYLE_KEYS =
  /\b(color|backgroundColor|background|borderColor|fill|stroke|padding(?:Top|Right|Bottom|Left|Inline|Block)?|margin(?:Top|Right|Bottom|Left|Inline|Block)?|gap|rowGap|columnGap|borderRadius|fontSize)\s*:/;

/** Icon packages the guide does not sanction. Lucide is the house set. */
const FOREIGN_ICON_IMPORT =
  /from\s+["'](react-icons(?:\/[\w-]+)?|@heroicons\/react(?:\/[\w./-]+)?|@mui\/icons-material(?:\/[\w./-]+)?|react-feather|@phosphor-icons\/react)["']/;

/** Component kits the guide rules out for new product UI. */
const FOREIGN_UI_IMPORT = /from\s+["'](reactstrap|@mui\/material|antd|react-bootstrap)["']/;

const RULES = [
  {
    id: "raw-hex-colour",
    appliesTo: (file) => !isTokenSource(file),
    fix: "Use a semantic utility (bg-cardBackground, text-text-light-gray) or the CSS variable. A new colour is declared in every theme file first.",
    find(line) {
      const hits = [];
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const value = m[0].toLowerCase();
        // #rgb, #rrggbb, #rrggbbaa only; anything else is an id or a fragment.
        if (![4, 7, 9].includes(value.length)) continue;
        if (BRAND_LITERALS.has(value)) continue;
        hits.push(`raw colour ${m[0]}`);
      }
      return hits;
    },
  },
  {
    id: "raw-colour-function",
    appliesTo: (file) => !isTokenSource(file),
    fix: "Use a semantic utility or the CSS variable instead of a literal colour function.",
    find(line) {
      const hits = [];
      for (const m of line.matchAll(/\b(rgba?|hsla?)\(\s*[\d.]/g)) {
        hits.push(`raw colour ${m[1]}(...)`);
      }
      return hits;
    },
  },
  {
    id: "banned-radius",
    fix: "Use rounded-[2px] for key badges, rounded-sm or rounded-[4px] for compact controls, rounded-[5px] for cards and modals, rounded-full for avatars and dots.",
    find(line) {
      const hits = [];
      for (const m of line.matchAll(/\brounded(?:-[trbl]{1,2})?-(lg|xl|2xl|3xl)\b/g)) {
        hits.push(`rounded-${m[1]} is a generic large-SaaS radius`);
      }
      for (const m of line.matchAll(/\brounded(?:-[trbl]{1,2})?-\[(\d+)px\]/g)) {
        const px = Number(m[1]);
        if (!ALLOWED_ARBITRARY_RADII.has(px)) {
          hits.push(`rounded-[${px}px] is off the 2 / 4 / 5px radius scale`);
        }
      }
      return hits;
    },
  },
  {
    id: "gradient",
    fix: "The guide rules out gradients. Use a flat semantic surface token.",
    find(line) {
      const hits = [];
      if (/\bbg-gradient-to-[trbl]{1,2}\b/.test(line)) hits.push("Tailwind gradient utility");
      if (/\b(linear|radial|conic)-gradient\(/.test(line)) hits.push("CSS gradient");
      return hits;
    },
  },
  {
    id: "white-focus-ring",
    fix: "Inputs, popovers, dropdowns, badges and chips are borderless. Use surface contrast and the established overlay shadow. Kanban section containers are the only keyboard-focus exception.",
    find(line) {
      const hits = [];
      for (const m of line.matchAll(
        /\b(?:focus|focus-visible|focus-within)[:-](?:border|ring|outline)-(white|white-black)\b/g
      )) {
        hits.push(`${m[0]} paints a white focus ring`);
      }
      if (/\bfocus:border-white-black\b/.test(line)) hits.push("focus:border-white-black");
      return hits;
    },
  },
  {
    id: "arbitrary-text-size",
    fix: `Use a named size: ${NAMED_TEXT_SIZES.join(", ")}.`,
    find(line) {
      const hits = [];
      for (const m of line.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) {
        hits.push(`text-[${m[1]}px] bypasses the named type scale`);
      }
      return hits;
    },
  },
  {
    id: "off-scale-spacing",
    fix: "Build rhythm from the 4px scale (1, 2, 3, 4, 5, 6, 8). 2px and 6px half steps are allowed for compact internal alignment.",
    find(line) {
      const hits = [];
      const re = new RegExp(`\\b${SPACING_PREFIX}-\\[(\\d+(?:\\.\\d+)?)px\\]`, "g");
      for (const m of line.matchAll(re)) {
        const px = Number(m[1]);
        if (!Number.isInteger(px) || !spacingIsOnScale(px)) {
          hits.push(`${m[0]} is off the 4px spacing scale`);
        }
      }
      return hits;
    },
  },
  {
    id: "inline-style-colour-or-spacing",
    fix: "Move colour and spacing into Tailwind utilities or the component's semantic tokens. Inline style is for values only the runtime knows, such as a measured offset.",
    // Handled with file context, not a single line: see collectInlineStyleLines.
    find: () => [],
  },
  {
    id: "foreign-icon-set",
    fix: "Use lucide-react for new product icons unless the surrounding component already uses another family.",
    find(line) {
      const m = line.match(FOREIGN_ICON_IMPORT);
      return m ? [`imports icons from ${m[1]}`] : [];
    },
  },
  {
    id: "foreign-ui-kit",
    fix: "Compose from the existing Hypertask components. ConfirmDialog, ModalContainerCustom, LabelWrapper, UserAvatar and Tooltip cover most jobs.",
    find(line) {
      const m = line.match(FOREIGN_UI_IMPORT);
      return m ? [`imports UI primitives from ${m[1]}`] : [];
    },
  },
];

function isTokenSource(file) {
  return TOKEN_SOURCES.some((re) => re.test(file));
}

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function parseArgs(argv) {
  const out = { json: false, verifyTokens: false, base: null, head: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--verify-tokens") out.verifyTokens = true;
    else if (arg === "--base") out.base = argv[++i];
    else if (arg === "--head") out.head = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function resolveBase(explicit) {
  if (explicit) return explicit;
  for (const ref of ["origin/production", "pub/production", "production"]) {
    try {
      const mergeBase = git(["merge-base", ref, "HEAD"]).trim();
      if (mergeBase) return mergeBase;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "Cannot find a production base. Pass one explicitly: --base <ref-or-sha>."
  );
}

/**
 * Added lines of the diff, as { file -> Map(lineNumber -> text) }.
 * -U0 keeps the hunks to changed lines only.
 */
function addedLines(base, head) {
  const range = head ? [`${base}..${head}`] : [base];
  const diff = git(["diff", "-U0", "--no-color", "--no-ext-diff", ...range, "--", "src"]);
  const files = new Map();
  let current = null;
  let lineNo = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      current = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (current && !LINTED.test(current)) current = null;
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      if (!files.has(current)) files.set(current, new Map());
      files.get(current).set(lineNo, raw.slice(1));
      lineNo += 1;
    }
  }
  return files;
}

/**
 * Line numbers that sit inside a `style={{ ... }}` object and carry a colour or
 * spacing key. Needs whole-file context because the object spans lines, so the
 * file is read at `head` rather than from the diff.
 */
function collectInlineStyleLines(file, head) {
  let text;
  try {
    text = head
      ? git(["show", `${head}:${file}`])
      : readFileSync(path.join(REPO_ROOT, file), "utf8");
  } catch {
    return new Map();
  }

  const flagged = new Map();
  const lines = text.split("\n");
  let depth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let rest = line;

    if (depth === 0) {
      const open = line.indexOf("style={{");
      if (open === -1) continue;
      depth = 1;
      rest = line.slice(open + "style={{".length);
      if (INLINE_STYLE_KEYS.test(rest)) flagged.set(i + 1, rest.trim());
    } else if (INLINE_STYLE_KEYS.test(rest)) {
      flagged.set(i + 1, rest.trim());
    }

    for (const ch of rest) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      if (depth <= 0) break;
    }
    if (depth < 0) depth = 0;
  }
  return flagged;
}

/** `path-or-prefix::rule-id` or `path-or-prefix` (all rules). `#` comments. */
function loadAllowlist() {
  if (!existsSync(ALLOW_FILE)) return [];
  return readFileSync(ALLOW_FILE, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((entry) => {
      const [target, rule] = entry.split("::");
      return { target: target.trim(), rule: (rule || "").trim() || null };
    });
}

function isAllowed(allowlist, file, ruleId) {
  return allowlist.some(
    (e) => file.startsWith(e.target) && (e.rule === null || e.rule === ruleId)
  );
}

function lint({ base, head }) {
  const allowlist = loadAllowlist();
  const files = addedLines(base, head);
  const findings = [];

  for (const [file, lineMap] of files) {
    const inlineStyle = isAllowed(allowlist, file, "inline-style-colour-or-spacing")
      ? new Map()
      : collectInlineStyleLines(file, head);

    for (const [line, text] of [...lineMap].sort((a, b) => a[0] - b[0])) {
      for (const rule of RULES) {
        if (isAllowed(allowlist, file, rule.id)) continue;
        if (rule.appliesTo && !rule.appliesTo(file)) continue;

        let messages = rule.find(text);
        if (rule.id === "inline-style-colour-or-spacing" && inlineStyle.has(line)) {
          messages = ["inline style sets colour or spacing"];
        }
        for (const message of messages) {
          findings.push({ file, line, rule: rule.id, message, fix: rule.fix });
        }
      }
    }
  }
  return { filesChecked: [...files.keys()], findings };
}

/**
 * tokens.json points at the real sources rather than forking them. This keeps
 * the pointer honest: the type scale it records must still match
 * tailwind.config.ts, or the file has rotted.
 */
function verifyTokens() {
  if (!existsSync(TOKENS_FILE)) {
    return [`docs/design/tokens.json is missing.`];
  }
  const tokens = JSON.parse(readFileSync(TOKENS_FILE, "utf8"));
  const config = readFileSync(TAILWIND_CONFIG, "utf8");
  const block = config.match(/fontSize\s*:\s*\{([\s\S]*?)\n\s*\}/);
  if (!block) return ["Cannot find the fontSize scale in tailwind.config.ts."];

  const live = new Map();
  for (const m of block[1].matchAll(/"([\w-]+)"\s*:\s*"(\d+px)"/g)) {
    live.set(m[1], m[2]);
  }
  const recorded = tokens.typography?.scale ?? {};
  const problems = [];
  for (const [name, value] of Object.entries(recorded)) {
    if (!live.has(name)) problems.push(`tokens.json records text-${name}, tailwind.config.ts does not.`);
    else if (live.get(name) !== value) {
      problems.push(`text-${name} is ${live.get(name)} in tailwind.config.ts, ${value} in tokens.json.`);
    }
  }
  for (const name of live.keys()) {
    if (name === "modalSmall") continue; // legacy alias, documented as such
    if (!(name in recorded)) problems.push(`tailwind.config.ts has text-${name}, tokens.json does not.`);
  }
  return problems;
}

function report(result, asJson) {
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          verdict: result.findings.length ? "concerns" : "pass",
          filesChecked: result.filesChecked,
          findings: result.findings,
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  if (!result.filesChecked.length) {
    console.log("design-lint: no linted UI files changed.");
    return;
  }
  if (!result.findings.length) {
    console.log(
      `design-lint: clean. ${result.filesChecked.length} changed UI file(s) checked.`
    );
    return;
  }

  console.log(
    `design-lint: ${result.findings.length} violation(s) on changed lines.\n`
  );
  let lastFile = null;
  for (const f of result.findings) {
    if (f.file !== lastFile) {
      console.log(`${f.file}`);
      lastFile = f.file;
    }
    console.log(`  ${f.line}: [${f.rule}] ${f.message}`);
    console.log(`      fix: ${f.fix}`);
  }
  console.log(
    "\nThe rules are docs/design/STYLE-GUIDE.md. An owner-approved exception goes in docs/design/lint-allow.txt with the ticket that approved it."
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`design-lint: ${err.message}`);
    return 2;
  }

  if (args.help) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
    return 0;
  }

  if (args.verifyTokens) {
    const problems = verifyTokens();
    if (problems.length) {
      console.error("design-lint --verify-tokens:\n  " + problems.join("\n  "));
      return 1;
    }
    console.log("design-lint: docs/design/tokens.json matches tailwind.config.ts.");
    return 0;
  }

  let base;
  try {
    base = resolveBase(args.base);
  } catch (err) {
    console.error(`design-lint: ${err.message}`);
    return 2;
  }

  let result;
  try {
    result = lint({ base, head: args.head });
  } catch (err) {
    console.error(`design-lint: cannot evaluate the diff: ${err.message}`);
    return 2;
  }

  report(result, args.json);
  return result.findings.length ? 1 : 0;
}

process.exit(main());
