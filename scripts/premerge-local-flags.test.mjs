import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localFlagModes, readPlainQaFlags } from "./premerge-local-flags.mjs";

test("live Everyone modes survive; all other registry keys are Owner + QA", () => {
  assert.deepEqual(localFlagModes(["released", "off", "new"], { released: true, off: false, retired: true }), {
    released: "EVERYONE", off: "OWNER_AND_QA", new: "OWNER_AND_QA",
  });
});

test("repeatable overrides apply in order, including disabling a live released flag", () => {
  assert.deepEqual(localFlagModes(["released", "new"], { released: true }, ["released=OFF", "new=OWNER_ONLY", "new=OWNER_AND_QA"]), {
    released: "OFF", new: "OWNER_AND_QA",
  });
  for (const value of ["unknown=OFF", "new=INVALID", "new=OFF=EVERYONE", "new", "new=", "=OFF"]) {
    assert.throws(() => localFlagModes(["new"], { released: true }, [value]), /Invalid --flag/);
  }
});

test("unreadable or invalid live views fail closed, not back to the stale snapshot", () => {
  for (const live of [null, [], {}, "invalid", { key: "yes" }]) {
    assert.throws(() => localFlagModes(["key"], live), /Invalid plain QA/);
  }
});

test("live read uses only app QA cookies, forbids redirects and rejects failed authentication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "premerge-flags-"));
  const file = path.join(root, "state.json");
  try {
    await writeFile(file, JSON.stringify({ cookies: [
      { domain: "app.hypertask.ai", name: "session", value: "fixture" },
      { domain: ".hypertask.ai", name: "shared", value: "fixture2" },
      { domain: "other.example", name: "wrong", value: "never-send" },
    ] }));
    const flags = await readPlainQaFlags(file, async (url, options) => {
      assert.equal(url, "https://app.hypertask.ai/api/flags");
      assert.equal(options.headers.Cookie, "session=fixture; shared=fixture2");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ flags: { released: true } }) };
    });
    assert.deepEqual(flags, { released: true });
    await assert.rejects(readPlainQaFlags(file, async () => ({ ok: false })), /Cannot read live flags/);
    await writeFile(file, JSON.stringify({ cookies: [] }));
    await assert.rejects(readPlainQaFlags(file, async () => assert.fail("must not fetch")), /no app cookies/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
