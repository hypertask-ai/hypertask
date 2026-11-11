import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finish, readArgs, requireLoopback } from "./drive-grade.mjs";

export async function driveMain(area, label, argv, breaks, run) {
  const args = readArgs(argv);
  const base = args.base || process.env.VERIFY_QA_BASE || "";
  const state = args.state || process.env.VERIFY_QA_STATE_FILE || "";
  if (!requireLoopback(base, label)) process.exit(2);
  if (!state) {
    console.error(`${label} needs --state <storageState.json> (or VERIFY_QA_STATE_FILE)`);
    process.exit(2);
  }
  if (args.breakStep && !breaks[args.breakStep]) {
    console.error(`${label} unknown break ${args.breakStep}`);
    process.exit(2);
  }
  const dir = args.dir || path.join(os.tmpdir(), `${area}-drive-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const steps = [];
  const step = (name, pass, detail) => {
    steps.push({ name, pass });
    console.log(`${pass ? "PASS" : "FAIL"}: ${name} ${JSON.stringify(detail ?? "")}`);
  };
  try {
    await run({ ...args, base, state, dir, step });
  } catch (error) {
    step("run", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  process.exitCode = finish(area, steps, args.breakStep, breaks[args.breakStep]);
}
