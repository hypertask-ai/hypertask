import assert from "node:assert/strict";
import test from "node:test";
import { getAgentAvatarDataUri } from "./avatar";

test("generated agent avatar is deterministic per id and distinct across ids", () => {
  const a1 = getAgentAvatarDataUri("agent-1");
  const a2 = getAgentAvatarDataUri("agent-1");
  const b = getAgentAvatarDataUri("agent-2");

  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^data:image\/svg\+xml;/);
});
