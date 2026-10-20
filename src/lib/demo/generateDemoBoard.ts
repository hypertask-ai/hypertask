import { createGateway, generateText, Output } from "ai";
import { z } from "zod";

import { cappedDemoModel, demoCapsEnabled } from "./demoAllowance";
import { backgroundClaudeModelEnabled } from "@/app/api/ai/_lib/planGate";

const DEMO_MODEL = "openai/gpt-6-luna";
const DEMO_CLAUDE_MODEL = "anthropic/claude-haiku-5.5";

const BoardSchema = z.object({
  name: z.string().min(1).max(40),
  views: z
    .array(
      z.object({
        title: z.string().min(1).max(24),
        filterType: z.enum(["label", "priority", "due"]),
        filterValue: z.string().min(1).max(20),
      }),
    )
    .min(3)
    .max(5),
  columns: z
    .array(
      z.object({
        title: z.string().min(1).max(24),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).max(80),
              label: z.string().max(20).nullable(),
              priority: z.number().int().min(1).max(4).nullable(),
              dueInDays: z.number().int().min(-3).max(14).nullable(),
            }),
          )
          .min(2)
          .max(5),
      }),
    )
    .length(3),
});

const SYSTEM = [
  "You generate a starter Kanban board for a first-time user based on the purpose they type.",
  "Produce a short, real project `name` for this purpose (Title Case, 2-4 words, no quotes).",
  "Produce 3-5 filtered `views` as {title, filterType, filterValue} objects.",
  "Each view must match at least one but fewer than all tasks, and the views should have different task counts.",
  "For a label view, use filterType `label` and copy the exact lowercase label into filterValue.",
  "For a priority view, use filterType `priority` and use `1`, `2`, `3`, or `4` as filterValue.",
  "For a due-date view, use filterType `due` and exactly `this-week` as filterValue.",
  "View titles are Title Case and max 3 words.",
  "Return exactly 3 columns titled \"To Do\", \"In Progress\", \"Done\".",
  "Put 2-4 short, concrete, actionable task titles in each column, tailored to the purpose.",
  "Front-load the earliest work in \"To Do\"; \"Done\" holds 1-2 things already settled (e.g. research, scoping).",
  "Task titles are max ~7 words, no trailing punctuation.",
  "Optionally give a task ONE short lowercase label (e.g. design, research, copy) and, sparingly, a priority 1-4 (1=urgent).",
  "Give AT LEAST 5 tasks a `dueInDays` value: 1-2 slightly overdue (-3 to -1), several due this week, and a few due next week (up to 14).",
].join(" ");

export type DemoBoard = z.infer<typeof BoardSchema>;

export class DemoBoardGenerationUnavailableError extends Error {
  constructor() {
    super("Demo board generation is unavailable");
    this.name = "DemoBoardGenerationUnavailableError";
  }
}

const DUE_DATE_FALLBACKS = [-2, -1, 2, 5, 9] as const;

function ensureMinimumDueDates(board: DemoBoard): DemoBoard {
  const tasks = board.columns.flatMap((column) => column.tasks);
  let datedTaskCount = tasks.filter((task) => task.dueInDays !== null).length;
  let fallbackIndex = 0;

  for (const task of tasks) {
    if (datedTaskCount >= DUE_DATE_FALLBACKS.length) break;
    if (task.dueInDays !== null) continue;

    task.dueInDays = DUE_DATE_FALLBACKS[fallbackIndex];
    fallbackIndex += 1;
    datedTaskCount += 1;
  }

  return board;
}

export async function generateDemoBoard(purpose: string, teamId?: string): Promise<DemoBoard> {
  const apiKey = process.env.DEMO_AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new DemoBoardGenerationUnavailableError();
  }

  const claude = await backgroundClaudeModelEnabled(null);
  let capsEnabled: boolean;
  try {
    capsEnabled = await demoCapsEnabled();
  } catch {
    throw new DemoBoardGenerationUnavailableError();
  }
  const modelSlug = claude ? DEMO_CLAUDE_MODEL : DEMO_MODEL;
  const rawModel = createGateway({ apiKey })(modelSlug);
  const model = capsEnabled ? cappedDemoModel(rawModel, modelSlug, apiKey, teamId) : rawModel;
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: BoardSchema }),
      maxOutputTokens: 4096,
      maxRetries: 2,
      providerOptions: {
        ...(claude ? {} : { openai: { reasoningEffort: "low" } }),
        gateway: { tags: ["demo-board", ...(capsEnabled && teamId ? [`team:${teamId}`] : [])] },
      },
      system: SYSTEM,
      prompt: `Board purpose: ${purpose}`,
    });

    return ensureMinimumDueDates(output);
  } catch (error) {
    if (capsEnabled) throw new DemoBoardGenerationUnavailableError();
    throw error;
  }
}
