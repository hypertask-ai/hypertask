import assert from "node:assert/strict";
import test from "node:test";
import { warmTiptapEditor } from "../src/components/RTE/warmEditor";

test("warm-up builds and destroys exactly one editor and is a no-op the second time", async () => {
  const events: string[] = [];
  const build = async () => {
    events.push("build");
    return { destroy: () => void events.push("destroy") };
  };

  await warmTiptapEditor(build);
  await warmTiptapEditor(build);

  assert.deepEqual(events, ["build", "destroy"]);
});
