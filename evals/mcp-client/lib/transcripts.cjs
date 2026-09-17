"use strict";

const fs = require("node:fs");
const path = require("node:path");

function transcriptsPath() {
  return path.join(__dirname, "..", "transcripts.json");
}

function loadTranscripts(filePath = transcriptsPath()) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw.recordings)) {
    throw new Error("Transcripts must contain a recordings array");
  }
  return raw;
}

function recordingKey(taskId, client, transport) {
  return `${taskId}:${client}:${transport}`;
}

function indexTranscripts(transcripts) {
  const byKey = new Map();
  for (const recording of transcripts.recordings) {
    byKey.set(
      recordingKey(recording.taskId, recording.client, recording.transport),
      recording,
    );
  }
  return byKey;
}

function isIndependentRecording(task, recording, transport) {
  if (!recording?.observation) return false;
  if (recording.provenance !== `${recording.client}:${transport}`) return false;
  const stdout =
    transport === "mcp"
      ? (recording.observation.tools || []).some((tool) => tool.stdout)
      : (recording.observation.commands || []).some((command) => command.stdout);
  if (!stdout) return false;
  if (transport === "mcp") {
    const copied = JSON.stringify(recording.observation.tools) === JSON.stringify(task.mcp.tools);
    return !copied;
  }
  const copied =
    JSON.stringify((recording.observation.commands || []).map((command) => command.argv)) ===
    JSON.stringify(task.cli.commands.map((command) => command.argv));
  return !copied || Boolean(recording.observation.commands?.[0]?.stdout);
}

module.exports = {
  transcriptsPath,
  loadTranscripts,
  recordingKey,
  indexTranscripts,
  isIndependentRecording,
};
