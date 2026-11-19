import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { escapingSymlink, fatalLine } from "./up-guards.cjs";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "up-guards-"));
  const checkout = join(root, "checkout");
  const elsewhere = join(root, "elsewhere", "node_modules");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });
  return { checkout, elsewhere };
}

test("a node_modules symlink resolving outside the checkout is named", () => {
  const { checkout, elsewhere } = workspace();
  symlinkSync(elsewhere, join(checkout, "node_modules"));
  assert.equal(escapingSymlink(join(checkout, "node_modules"), checkout), elsewhere);
});

test("a real directory or an in-checkout symlink is allowed", () => {
  const { checkout } = workspace();
  assert.equal(escapingSymlink(join(checkout, "node_modules"), checkout), null);
  mkdirSync(join(checkout, "packages", "node_modules"), { recursive: true });
  symlinkSync(join(checkout, "packages", "node_modules"), join(checkout, "node_modules"));
  assert.equal(escapingSymlink(join(checkout, "node_modules"), checkout), null);
});

test("a fatal Next line is reported, a boot log is not", () => {
  const { checkout } = workspace();
  const boot = ["▲ Next.js 16.4.2 (Turbopack)", "- Local: http://localhost:3000", "✓ Ready in 1263ms"].join("\n");
  assert.equal(fatalLine(boot), null);
  const fatal = [
    "Turbopack build encountered 1 error:",
    "./src/app",
    "Error: Could not find the Next.js package (next/package.json)",
  ].join("\n");
  assert.equal(fatalLine(fatal), "Turbopack build encountered 1 error:");
  assert.equal(fatalLine("Error: listen EADDRINUSE: address already in use :::3000").startsWith("Error: listen EADDRINUSE"), true);
  assert.equal(fatalLine(""), null);
  assert.equal(fatalLine(null), null);
  assert.equal(escapingSymlink(join(checkout, "node_modules"), checkout), null);
});
