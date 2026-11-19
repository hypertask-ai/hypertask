import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { home, json } from "../test-helpers.mjs";

test("shot needs a scheme, an output path and an absolute one", async () => {
  for (const [args, next] of [
    [["shot", "app.hypertask.ai", "--out", "/tmp/a.png"], /full URL/],
    [["shot", "https://app.hypertask.ai/my-tasks"], /--out/],
    [["shot", "https://app.hypertask.ai/my-tasks", "--out", "a.png"], /\$PWD/],
  ]) {
    const result = await json(home(), args);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(result.json.error.next, next);
  }
});

test("shot --dry-run wraps phone-shot with the chosen state and viewport", async () => {
  const dir = home();
  mkdirSync(join(dir, "default", "browser"), { recursive: true });
  writeFileSync(join(dir, "default", "browser", "state.json"), "{}", { mode: 0o600 });
  const result = await json(dir, ["shot", "http://127.0.0.1:3000/project?id=7049", "--out", "/tmp/board.png", "--viewport", "390x844", "--dry-run"]);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.json.data.dryRun, true);
  assert.equal(result.json.target, "local");
  assert.match(result.json.data.steps[0], /phone-shot\.sh http:\/\/127\.0\.0\.1:3000\/project\?id=7049 \/tmp\/board\.png --state .*browser\/state\.json --viewport 390x844/);
});
