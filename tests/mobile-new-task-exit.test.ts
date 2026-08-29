import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  armBackDismiss,
  closeBackDismissBeforeNavigation,
} from "../src/lib/mobile/backDismiss";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const createFakeTarget = () => {
  const listeners: Array<() => void> = [];
  const entries: any[] = [];
  const target = {
    history: {
      state: { existing: true } as any,
      pushState(state: any, _title = "", url?: string) {
        entries.push(state);
        target.history.state = state;
        if (url) target.location.href = url;
      },
      back() {
        entries.pop();
        listeners.forEach((listener) => listener());
      },
    },
    location: { href: "https://app.hypertask.ai/project/15" },
    addEventListener(_type: "popstate", listener: () => void) {
      listeners.push(listener);
    },
    removeEventListener(_type: "popstate", listener: () => void) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  return { target, entries, listeners };
};

test("the back gesture dismisses an empty draft instead of leaving the page", () => {
  const { target, entries } = createFakeTarget();
  let dismissed = 0;

  armBackDismiss(target, {
    key: "createTaskModal",
    onBack: () => {
      dismissed += 1;
    },
    shouldRearm: () => false,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].createTaskModal, true);
  assert.equal(entries[0].existing, true, "existing history state is preserved");

  target.history.back();

  assert.equal(dismissed, 1);
  assert.equal(entries.length, 0);
});

test("back keeps working while a discard confirmation is open", () => {
  const { target, entries } = createFakeTarget();
  let dismissed = 0;
  let stillOpen = true;

  armBackDismiss(target, {
    key: "createTaskModal",
    onBack: () => {
      dismissed += 1;
    },
    shouldRearm: () => stillOpen,
  });

  target.history.back();
  assert.equal(dismissed, 1);
  assert.equal(entries.length, 1, "a fresh entry is armed while the modal stays up");

  stillOpen = false;
  target.history.back();
  assert.equal(dismissed, 2);
  assert.equal(entries.length, 0);
});

test("a second back after dismissal is left to the page", () => {
  const { target } = createFakeTarget();
  let dismissed = 0;

  armBackDismiss(target, {
    key: "createTaskModal",
    onBack: () => {
      dismissed += 1;
    },
  });

  target.history.back();
  target.history.back();

  assert.equal(dismissed, 1);
});

test("closing by any other control removes the pushed history entry", () => {
  const { target, entries, listeners } = createFakeTarget();
  let dismissed = 0;

  const disarm = armBackDismiss(target, {
    key: "createTaskModal",
    onBack: () => {
      dismissed += 1;
    },
  });

  disarm();

  assert.equal(entries.length, 0, "no dead history step is left behind");
  assert.equal(dismissed, 0, "disarming must not re-run the dismiss handler");
  assert.equal(listeners.length, 0);
});

test("saving removes the mobile modal history entry before opening the task", async () => {
  const { target, entries } = createFakeTarget();
  const disarm = armBackDismiss(target, {
    key: "createTaskModal",
    onBack: () => assert.fail("saving must not run the back-dismiss action"),
  });

  await closeBackDismissBeforeNavigation(
    target,
    "createTaskModal",
    disarm,
  );
  target.history.pushState(
    { taskDetail: true },
    "",
    "https://app.hypertask.ai/detail/project-15/5713",
  );

  assert.equal(entries.length, 1, "only the created task remains above the board");
  assert.equal(entries[0].taskDetail, true, "the created task stays open");
});

test("the mobile new-task modal renders a close control and arms back dismissal", () => {
  const titleSource = read(
    "src/components/Modals/CreateTaskGloballyModal/TaskTitleModal.tsx",
  );
  assert.match(titleSource, /data-mobile-new-task-close/);
  assert.match(titleSource, /aria-label="Close new task"/);
  assert.match(titleSource, /closeHandler\(false\)/);

  const bodySource = read(
    "src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx",
  );
  assert.match(bodySource, /armBackDismiss\(window, \{/);
  assert.match(bodySource, /key: "createTaskModal"/);
  assert.match(
    bodySource,
    /if \(!_mbl \|\| isNewTaskPage \|\| typeof window === "undefined"\) return;/,
    "the /new route already navigates on close, so it must not push a second entry",
  );
});
