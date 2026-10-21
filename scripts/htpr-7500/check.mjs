import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

execFileSync(process.execPath, [
  "--test",
  "tests/htpr-7342-web-writing-task-writer.test.cjs",
  "tests/htpr-7471-writer-board-format.test.cjs",
  "tests/htpr-7500-writer-old-structure.test.cjs",
  "tests/ai-prompt-registry.test.cjs",
], { cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: "inherit" });

console.log("HTPR-7500 checks passed");
