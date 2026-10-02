import assert from "node:assert/strict";
import test from "node:test";

import { runtimeStateKey } from "../src/app/agents/[agentId]/runtimeStateKey";

const agent = (
  runtimeType: "NATIVE" | "EXTERNAL",
  source: "runtime" | "inferred",
  health: "working" | "connected" | "waiting" | "stalled" | "offline",
  revokedAt: string | null = null,
) => ({ runtimeType, revokedAt, operations: { source, health } });

test("a native agent with no runtime report runs on demand, not offline (HTPR-6836)", () => {
  assert.equal(runtimeStateKey(agent("NATIVE", "inferred", "offline")), "on_demand");
});

test("a switched-off native agent is still offline", () => {
  assert.equal(
    runtimeStateKey(agent("NATIVE", "inferred", "offline", "2026-10-02T00:00:00Z")),
    "offline",
  );
});

test("an external agent with no runtime report is offline", () => {
  assert.equal(runtimeStateKey(agent("EXTERNAL", "inferred", "offline")), "offline");
});

test("a live runtime report wins for any agent", () => {
  assert.equal(runtimeStateKey(agent("NATIVE", "runtime", "working")), "working");
  assert.equal(runtimeStateKey(agent("EXTERNAL", "runtime", "stalled")), "stalled");
});
