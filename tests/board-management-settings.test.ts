import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  archivedProjectsForTeam,
  canLeaveBoard,
  canManageBoardLifecycle,
} from "../src/lib/boardManagement";
import type { IProject } from "../src/models/model";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const project = (overrides: Partial<IProject> = {}) =>
  ({
    id: 1,
    name: "one",
    ownerId: "6",
    teamId: "team-a",
    members: [],
    ...overrides,
  }) as IProject;

test("board lifecycle permissions match the server owner/admin boundary", () => {
  assert.equal(canManageBoardLifecycle(project(), 6), true);
  assert.equal(
    canManageBoardLifecycle(
      project({
        ownerId: "9",
        members: [
          {
            agentId: undefined,
            role: "Admin",
            status: "Accepted",
            userId: 6,
          },
        ] as IProject["members"],
      }),
      6,
    ),
    true,
  );
  assert.equal(
    canManageBoardLifecycle(
      project({
        ownerId: "9",
        members: [
          { role: "Member", status: "Accepted", userId: 6 },
        ] as IProject["members"],
      }),
      6,
    ),
    false,
  );
  assert.equal(canLeaveBoard(project(), 6), false);
  assert.equal(canLeaveBoard(project({ ownerId: "9" }), 6), true);
});

test("archived board recovery stays scoped to the selected team", () => {
  const result = archivedProjectsForTeam(
    [
      project({ id: 1, title: "Zulu" }),
      project({ id: 2, teamId: "team-b", title: "Other" }),
      project({ id: 3, title: "Alpha" }),
      project({ id: 4, ownerId: "9", title: "Someone else's" }),
    ],
    "team-a",
    6,
  );

  assert.deepEqual(
    result.map(({ id }) => id),
    [3, 1],
  );
});

test("Manage boards opens current-board Settings and the old modal is retired", () => {
  const commands = read("src/components/commands.tsx");
  assert.match(
    commands,
    /case CommandMode\.ManageTeams:[\s\S]*?openSettings\("board-general"\)/,
  );
  assert.equal(
    fs.existsSync(
      path.join(root, "src/components/Modals/ManageBoard/ManageTeams.tsx"),
    ),
    false,
  );
});

test("archiving the active board confirms success and replaces its route", () => {
  const archive = read(
    "src/components/Modals/commands/confirmArchiveBoard.tsx",
  );
  assert.match(archive, /import toast from "react-hot-toast"/);
  assert.match(
    archive,
    /if \(currentProject\?\.id === targetProject\.id\)[\s\S]*?router\.replace\(firstProject\?\.id \? `\/project\?id=\$\{firstProject\.id\}` : "\/project"\)/,
  );
  assert.match(
    archive,
    /toast\.success\(`Archived \$\{targetProject\.title \?\? targetProject\.name \?\? "board"\}`\)/,
  );
  assert.ok(
    archive.indexOf("toast.success") <
      archive.indexOf('queryClient.refetchQueries({queryKey:["getAllTeamsMinimal"]})'),
    "success feedback must not wait for cache refreshes",
  );
  assert.match(archive, /try \{[\s\S]*?await Promise\.all\([\s\S]*?queryClient\.refetchQueries/);
});

test("canceling a lifecycle dialog preserves the board and restore refreshes every board cache", () => {
  const lifecycle = read(
    "src/components/Modals/Settings/BoardLifecycleSettings.tsx",
  );
  assert.match(
    lifecycle,
    /setDialog\(null\);\s+if \(!response \|\| !project\) return;\s+void refreshBoardData/,
  );

  const restoreStart = lifecycle.indexOf("const handleRestore");
  const restoreEnd = lifecycle.indexOf("return (", restoreStart);
  const restore = lifecycle.slice(restoreStart, restoreEnd);
  for (const queryKey of [
    "getAllTeamsMinimal",
    "projectsAll",
    "projectsAllMinimal",
    "getAllFavorites",
  ]) {
    assert.match(restore, new RegExp(`queryKey: \\[\"${queryKey}\"\\]`));
  }
});

test("successful removal replaces the remembered return route", () => {
  const lifecycle = read(
    "src/components/Modals/Settings/BoardLifecycleSettings.tsx",
  );
  assert.match(
    lifecycle,
    /if \(firstProject\?\.id\)[\s\S]*?rememberSettingsReturnTo\(replacementPath\)/,
  );
  assert.match(
    lifecycle,
    /nookies\.destroy\(null, "previousBoard", \{ path: "\/" \}\);\s+rememberSettingsReturnTo\("\/"\)/,
  );
});

test("removing a Settings selection changes navigation only when it is the active board", () => {
  const lifecycle = read(
    "src/components/Modals/Settings/BoardLifecycleSettings.tsx",
  );
  const identityGuard = lifecycle.indexOf(
    "if (currentProject?.id !== removedProjectId) return;",
  );
  const navigationUpdate = lifecycle.indexOf(
    "rememberSettingsReturnTo(replacementPath)",
  );
  assert.ok(identityGuard > -1);
  assert.ok(navigationUpdate > identityGuard);
});
