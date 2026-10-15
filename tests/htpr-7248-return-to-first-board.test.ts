import assert from "node:assert/strict";
import test from "node:test";
import { returnToFirstBoard } from "../src/lib/firstScreen/returnToFirstBoard";

function harness(getFirstProject: () => Promise<{ data?: any }>) {
  const navigations: string[] = [];
  let signOuts = 0;
  const run = () => returnToFirstBoard({
    getFirstProject,
    navigate: (url) => navigations.push(url),
    signOut: async () => { signOuts += 1; },
  });
  return { run, navigations, signOuts: () => signOuts };
}

test("a 400 from the first-board lookup signs the user out instead of rejecting", async () => {
  const axios400 = Object.assign(new Error("Request failed with status code 400"), { response: { status: 400 } });
  const h = harness(async () => { throw axios400; });
  await assert.doesNotReject(h.run());
  assert.equal(h.signOuts(), 1);
  assert.deepEqual(h.navigations, []);
});

test("a server or network failure keeps the user signed in and does not reject", async () => {
  const axios500 = Object.assign(new Error("Request failed with status code 500"), { response: { status: 500 } });
  for (const failure of [axios500, new Error("Network Error")]) {
    const h = harness(async () => { throw failure; });
    await assert.doesNotReject(h.run());
    assert.equal(h.signOuts(), 0);
    assert.deepEqual(h.navigations, []);
  }
});

test("a response without a board id signs out instead of opening /project?id=undefined", async () => {
  const h = harness(async () => ({ data: { message: "User not found" } }));
  await h.run();
  assert.equal(h.signOuts(), 1);
  assert.deepEqual(h.navigations, []);
});

test("still allowed: a signed-in user returns to their first board with its applied view", async () => {
  const project = {
    id: 42,
    project_view: { user_project_views: [{ appliedView: { slug: "my-view" } }] },
  };
  const h = harness(async () => ({ data: project }));
  await h.run();
  assert.equal(h.signOuts(), 0);
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0], "/project?id=42&view=my-view");
});
