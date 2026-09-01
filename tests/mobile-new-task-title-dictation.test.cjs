const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const { appendTitleDictation } = jiti(
  path.join(root, "src/components/Modals/CreateTaskGloballyModal/titleDictation.ts"),
);
const { createDictationCoordinator } = jiti(
  path.join(root, "src/lib/dictationCoordinator.ts"),
);

test("title dictation appends to the latest typed title without changing its text", () => {
  assert.equal(appendTitleDictation("Ship mobile", "dictation icon"), "Ship mobile dictation icon");
  assert.equal(appendTitleDictation("Ship mobile ", " dictation icon "), "Ship mobile dictation icon");
  assert.equal(appendTitleDictation("", "  New title  "), "New title");
  assert.equal(appendTitleDictation("Typed while waiting", "   "), "Typed while waiting");
});

test("dictation coordinator rejects peers and ignores stale releases", () => {
  const busyStates = [];
  const coordinator = createDictationCoordinator((busy) => busyStates.push(busy));
  const titleLease = coordinator.acquire();

  assert.ok(titleLease);
  assert.equal(coordinator.acquire(), null, "description cannot start while title owns dictation");
  assert.equal(coordinator.release(Symbol("stale")), false);
  assert.equal(coordinator.owns(titleLease), true, "stale cleanup cannot release the active owner");
  assert.equal(coordinator.release(titleLease), true);

  const descriptionLease = coordinator.acquire();
  assert.ok(descriptionLease);
  assert.equal(coordinator.owns(titleLease), false, "late title delivery is stale after release");
  assert.equal(coordinator.owns(descriptionLease), true);
  assert.deepEqual(busyStates, [true, false, true]);
});

test("mobile new-task title uses one accessible recorder tied to modal ownership", () => {
  const title = read("src/components/Modals/CreateTaskGloballyModal/TaskTitleModal.tsx");
  const tiptap = read("src/components/RTE/TiptapCreateTaskModal.tsx");
  const audio = read("src/components/RTE/Components/AudioButton.tsx");
  const modalState = read("src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts");

  assert.match(title, /_mbl && \([\s\S]*?<AudioButton/);
  assert.equal((title.match(/id="create-task-title-audio-button"/g) || []).length, 1);
  assert.match(title, /ariaLabel="Dictate task title"/);
  assert.match(title, /className="h-11 w-11 shrink-0 justify-center"/);
  assert.match(title, /dictationCoordinator=\{dictationCoordinator\}/);
  assert.match(title, /callbackHandler=\{appendDictationToTitle\}/);
  assert.match(
    modalState,
    /setFormValues\(\(current\) => \(\{[\s\S]*?appendTitleDictation\(current\.title, transcript\)/,
  );
  assert.match(tiptap, /<AttachmentsUpload[\s\S]*?dictationCoordinator=\{dictationCoordinator\}/);
  assert.match(audio, /const lease = dictationCoordinator\?\.acquire\(\)/);
  assert.match(audio, /if \(lease && !dictationCoordinator\?\.owns\(lease\)\)/);
  assert.match(audio, /dictationCoordinator\.owns\(lease\)/);
  assert.match(audio, /releaseDictationLease/);
});
