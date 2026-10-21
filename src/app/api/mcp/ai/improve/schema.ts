import { z } from "zod";

const NAMED_COMMANDS = [
  "ImproveReadability",
  "FixSpellingAndGrammar",
  "Summarize",
  "MakeShorter",
  "Simplify",
  "Unslop",
  "Structured",
] as const;
const TRANSLATE_COMMAND_RE = /^Translate:[A-Za-z][A-Za-z -]{0,39}$/;

export const requestSchema = z
  .object({
    project_id: z.coerce.number().int().positive(),
    task_id: z.coerce.number().int().positive().optional(),
    text: z.string().min(1),
    command: z
      .union([
        z.enum(NAMED_COMMANDS),
        z.string().regex(TRANSLATE_COMMAND_RE, "must be Translate:<Language>"),
      ])
      .default("ImproveReadability"),
  })
  .strict();

export type ImproveRequest = z.infer<typeof requestSchema>;
