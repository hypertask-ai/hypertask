const SUMMARY = /^(?:ℹ|#)[ \t]+(tests|pass|fail|cancelled|skipped|skip|todo)[ \t]+(\d+)[ \t]*$/;
const ANSI = /\u001b\[[0-9;]*m/g;

export function createExecutionCounter() {
  const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  let summaries = 0;
  let carry = "";

  const consume = (line) => {
    const match = SUMMARY.exec(line.replace(ANSI, "").trim());
    if (!match) return;
    const key = match[1] === "skip" ? "skipped" : match[1];
    totals[key] += Number(match[2]);
    if (key === "tests") summaries += 1;
  };

  return {
    push(text) {
      carry += text;
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) consume(line);
    },
    finish() {
      if (carry) consume(carry);
      carry = "";
      return { ...totals, summaries, executed: totals.pass + totals.fail };
    },
  };
}

export function combineCounters(...counters) {
  const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, summaries: 0 };
  for (const counted of counters) {
    for (const key of Object.keys(totals)) totals[key] += counted[key] ?? 0;
  }
  return { ...totals, executed: totals.pass + totals.fail };
}

export function executionFailure(counted, selected) {
  if (counted.executed > 0) return null;
  return `No test executed: ${selected} test file(s) selected, ${counted.skipped} skipped, 0 passed or failed. Skipped tests cannot prove a code change.`;
}
