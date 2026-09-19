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
  if (!recording.capturedAt || !recording.stdoutSha || !Array.isArray(recording.argv)) {
    return false;
  }
  if (recording.argv.length === 0) return false;
  if (!/^[a-f0-9]{64}$/.test(recording.stdoutSha)) return false;
  const copiedPlan =
    transport === "mcp"
      ? JSON.stringify(recording.observation.tools) === JSON.stringify(task.mcp.tools)
      : JSON.stringify((recording.observation.commands || []).map((command) => command.argv)) ===
        JSON.stringify(task.cli.commands.map((command) => command.argv));
  return !copiedPlan;
}

function writeTranscripts(transcripts, dest = transcriptsPath()) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(transcripts, null, 2)}\n`);
}

module.exports = {
  transcriptsPath,
  loadTranscripts,
  recordingKey,
  indexTranscripts,
  isIndependentRecording,
  writeTranscripts,
};
