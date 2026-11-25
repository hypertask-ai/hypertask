import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ESLint } from "eslint";
import parser from "@typescript-eslint/parser";
import { styleGuidePlugin } from "../eslint-local-rules/style-guide.mjs";

const commits = ["a51d88c970", "7b167459c5", "2be3533f8f", "60dd0ed907", "6423aae593"];
const directory = mkdtempSync(join(tmpdir(), "htpr-9611-proof-"));
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    files: ["**/*.tsx"],
    languageOptions: { parser },
    plugins: { "hypertask-style": styleGuidePlugin },
    rules: { "hypertask-style/no-forbidden-utilities": ["error", { ignoreRadiusBaseline: true }] },
  }],
});
let flagged = 0;
for (const sha of commits) {
  const files = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", sha, "--", "src/"], { encoding: "utf8" })
    .trim().split("\n").filter((file) => /\.(tsx|s?css)$/.test(file));
  let count = 0;
  for (const file of files) {
    const snapshot = join(directory, `${sha}-${basename(file)}`);
    writeFileSync(snapshot, execFileSync("git", ["show", `${sha}^:${file}`]));
    const [result] = await eslint.lintText(readFileSync(snapshot, "utf8"), { filePath: `src/__radius_proof__/${sha}/${basename(file)}` });
    const fatal = result.messages.find((message) => message.fatal);
    if (fatal) throw new Error(`${file}: ${fatal.message}`);
    for (const message of result.messages.filter((message) => message.messageId === "forbiddenRadius")) {
      count += 1;
      console.log(`${sha}^:${file}:${message.line}:${message.column} ${message.message} [${message.ruleId}]`);
    }
  }
  if (count) flagged += 1;
  else console.log(`${sha}: MISSED (${files.join(", ")})`);
}
console.log(`${flagged}/${commits.length} parent versions flagged; allowance=0; snapshots=${directory}`);
console.log("a51d88c970: rounded-t-lg is flagged, but the corrected var(--radius-chat-window) override is allowed by the requested token exemption.");
console.log("6423aae593: both rounded-[5px] skeleton classes are flagged; SCSS declarations are outside this JSX utility rule.");
if (!flagged) process.exitCode = 1;
