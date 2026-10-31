import { spawnSync } from "node:child_process";

// A known bug is a todo case that carries its ticket as the reason. A bare
// `# TODO` is a placeholder that never runs, so it is not a known bug.
const PASSING_TODO = /^\s*ok \d+ - (.*?) # TODO\s+(\S.*)$/;

export function findPassingTodos(tap) {
  return tap.split(/\r?\n/).flatMap((line) => {
    const match = PASSING_TODO.exec(line);
    if (!match || match[2].trim().startsWith("# SKIP")) return [];
    return [match[1].trim()];
  });
}

export function todoRemovalMessages(names, root) {
  return names.map((name) => {
    const result = spawnSync("git", ["grep", "-F", "-l", "--", name, "--", "tests"], {
      cwd: root,
      encoding: "utf8",
    });
    const file = result.status === 0 && result.stdout.trim()
      ? result.stdout.trim().split(/\r?\n/).join(", ")
      : "not found in tests";
    return `remove the todo marker: ${file} ${name}`;
  });
}
