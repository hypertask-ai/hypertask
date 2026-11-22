export const UPSTASH_DAILY_COMMAND_LIMIT = 300_000;
export const UPSTASH_SAMPLE_KEY = "upstash:command-sample:v1";
export const UPSTASH_ALARM_LOCK_KEY = "upstash:command-alarm:lock";
const DAY_MS = 24 * 60 * 60 * 1000;

export type CommandSample = { total: number; at: number };

export function readCommandTotal(info: string): number | null {
  const match = info.match(/^total_commands_processed:(\d+)$/m);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) ? total : null;
}

export function upstashAlarmDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function upstashAlarmMarker(day: string): string {
  return `upstash-daily-commands:${day}`;
}

export function nextCommandSample(previous: CommandSample | null, total: number, now: number): {
  commands: number | null;
  alert: boolean;
  next: CommandSample;
  replace: boolean;
} {
  if (!previous || total < previous.total || now < previous.at) {
    return { commands: null, alert: false, next: { total, at: now }, replace: true };
  }
  if (upstashAlarmDay(now) === upstashAlarmDay(previous.at)) {
    return { commands: null, alert: false, next: previous, replace: false };
  }
  const elapsed = now - previous.at;
  const commands = total - previous.total;
  const perDay = elapsed > DAY_MS + 5 * 60 * 1000 ? commands * DAY_MS / elapsed : commands;
  return {
    commands: Math.round(perDay),
    alert: perDay > UPSTASH_DAILY_COMMAND_LIMIT,
    next: { total, at: now },
    replace: true,
  };
}

export async function runUpstashCommandCheck(input: {
  now: number;
  info: string;
  readSample: () => Promise<string | null>;
  writeSample: (value: string) => Promise<void>;
  claim: () => Promise<boolean>;
  findTicket: (marker: string) => Promise<number | null>;
  createTicket: (ticket: { title: string; description: string; priorityIndex: number }) => Promise<number>;
}): Promise<{ commands: number | null; filed: boolean; taskId: number | null; error?: "unreadable" }> {
  const total = readCommandTotal(input.info);
  if (total === null) return { commands: null, filed: false, taskId: null, error: "unreadable" };
  const decision = nextCommandSample(parseSample(await input.readSample()), total, input.now);
  let filed = false;
  let taskId: number | null = null;
  if (decision.alert && decision.commands !== null && await input.claim()) {
    const day = upstashAlarmDay(input.now);
    const marker = upstashAlarmMarker(day);
    taskId = await input.findTicket(marker);
    if (taskId === null) {
      taskId = await input.createTicket({
        title: `Upstash served more than 300,000 requests on ${day}`,
        description: upstashAlarmDescription(decision.commands, day),
        priorityIndex: 1,
      });
      filed = true;
    }
  }
  if (decision.replace) await input.writeSample(JSON.stringify(decision.next));
  return { commands: decision.commands, filed, taskId };
}

function parseSample(raw: string | null): CommandSample | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CommandSample;
    if (!Number.isSafeInteger(value?.total) || value.total < 0) return null;
    if (!Number.isSafeInteger(value.at) || value.at < 0) return null;
    return { total: value.total, at: value.at };
  } catch {
    return null;
  }
}

export function upstashAlarmDescription(commands: number, day: string): string {
  const shown = commands.toLocaleString("en-US");
  return [
    `<p><strong>What's wrong or wanted:</strong> Upstash served ${shown} requests on ${day}, over the 300,000 a day line.</p>`,
    "<p><strong>Who it affects:</strong> Valentin pays the bill.</p>",
    "<p><strong>Recommended course and why:</strong> Find which sender grew and cut it. This check files one ticket for that day.</p>",
    "<p><strong>What Valentin must decide:</strong> nothing.</p>",
    "<p><strong>How to undo:</strong> close this ticket once a later day is back under 300,000 requests.</p>",
    `<p>Marker: ${upstashAlarmMarker(day)}</p>`,
  ].join("");
}
