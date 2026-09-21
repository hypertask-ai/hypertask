const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const streamDirectory = path.join(root, "src/app/api/ai/chat/stream");
const toolsDirectory = path.join(root, "src/lib/ai/tools/chat");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readChatToolSource(toolName) {
  return read(`src/lib/ai/tools/chat/${toolName}.ts`);
}

function readChatStreamSource() {
  const stream = [
    "route.ts",
    "buildTools.ts",
    "toolSupport.ts",
    "chatStreamSupport.ts",
    "post.ts",
  ]
    .map((file) => fs.readFileSync(path.join(streamDirectory, file), "utf8"))
    .join("\n");
  const buildTools = fs.readFileSync(path.join(streamDirectory, "buildTools.ts"), "utf8");
  const toolNames = [
    ...buildTools.matchAll(/@\/lib\/ai\/tools\/chat\/([^";]+)/g),
  ].map((match) => match[1]);
  const tools = toolNames
    .map((toolName) =>
      fs
        .readFileSync(path.join(toolsDirectory, `${toolName}.ts`), "utf8")
        .replace(/\s+return tool\(\{/, `\n    ${toolName}: tool({`),
    )
    .join("\n");
  return `${stream}\n${tools}`;
}

module.exports = { readChatStreamSource, readChatToolSource };
