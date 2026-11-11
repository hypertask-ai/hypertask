export const THEMES = ["porcelain", "graphite", "amoled", "graphite-2"];

export function requireLoopback(base, label) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base || "")) {
    console.error(`${label} refuses a non-loopback base: it drives a disposable seeded stack, never production`);
    return false;
  }
  return true;
}

export function themeLanded(requested, actual) {
  if (actual === requested) return true;
  return requested === "graphite" && actual === "graphite-2";
}

export function finish(area, steps, broken, targetName) {
  const failed = steps.filter((step) => !step.pass);
  if (broken) {
    const target = steps.find((step) => step.name === targetName);
    const detected = Boolean(target) && target.pass === false && !failed.some(step => ["run", "fixture cleaned"].includes(step.name));
    console.log(`negative control ${detected ? "ok" : "FAIL"}: ${broken} break ${detected ? "failed the step" : "was not detected"}`);
    return detected ? 0 : 1;
  }
  console.log(failed.length ? `${area} FAIL: ${failed.map((step) => step.name).join("; ")}` : `${area} ok`);
  return failed.length ? 1 : 0;
}

export function readArgs(argv) {
  const args = { breakStep: "", base: "", state: "", board: "", dir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--break") args.breakStep = argv[index += 1] ?? "";
    else if (arg === "--base") args.base = argv[index += 1] ?? "";
    else if (arg === "--state") args.state = argv[index += 1] ?? "";
    else if (arg === "--board") args.board = argv[index += 1] ?? "";
    else if (!arg.startsWith("--") && !args.dir) args.dir = arg;
  }
  return args;
}
