import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const networkCalls = new Set(["fetch", "generateText", "streamText", "generateObject", "streamObject", "generateImage", "embed", "embedMany", "getCredits"]);
const printer = ts.createPrinter({ removeComments: true });

export function callsInFile(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse network calls in ${path}`);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const axios = ts.isPropertyAccessExpression(callee) && callee.expression.getText(source) === "axios";
      if (networkCalls.has(name) || axios) {
        const code = printer.printNode(ts.EmitHint.Expression, node, source);
        const digest = createHash("sha256").update(code).digest("hex");
        calls.push({ id: `${path}:${digest}`, digest, code });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

export function checkCostNotes(base, head, cwd = process.cwd()) {
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const ancestor = git(["merge-base", base, head]).trim();
  const files = git(["diff", "--name-only", "--no-renames", "-z", ancestor, head]).split("\0")
    .filter(path => /^src\/.*\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\./.test(path));
  const read = (ref, path) => {
    const exists = git(["ls-tree", "--name-only", ref, "--", path]).trim();
    return exists ? git(["show", `${ref}:${path}`]) : "";
  };
  const previous = new Map();
  for (const path of files) for (const call of callsInFile(path, read(ancestor, path))) {
    previous.set(call.digest, (previous.get(call.digest) ?? 0) + 1);
  }
  const notes = JSON.parse(read(head, ".github/paid-api-cost-notes.json") || "{}");
  const missing = [];
  for (const path of files) for (const call of callsInFile(path, read(head, path))) {
    const count = previous.get(call.digest) ?? 0;
    if (count) { previous.set(call.digest, count - 1); continue; }
    const note = notes[call.id];
    if (!note || typeof note.maxUsdPerDay !== "number" || !Number.isFinite(note.maxUsdPerDay) || note.maxUsdPerDay < 0 ||
        typeof note.reason !== "string" || !note.reason.trim() || typeof note.source !== "string" || !/^https:\/\//.test(note.source)) {
      missing.push(call.id);
    }
  }
  if (missing.length) throw new Error(`New network calls need cost notes (maxUsdPerDay, reason, https source) in .github/paid-api-cost-notes.json:\n${missing.join("\n")}`);
  return "paid API cost notes ok";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [base, head] = process.argv.slice(2);
    if (!base || !head) throw new Error("base and head SHA required");
    console.log(checkCostNotes(base, head));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
