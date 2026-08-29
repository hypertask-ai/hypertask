import { z } from "zod";

// Named modes must match exactly what createPromptForTiptapForwardSlash
// implements as fixed prompts (src/app/api/ai/_lib/editorAi.ts). "Translate:*"
// is its own branch there (mode.startsWith("Translate")) and takes a language
// after the colon, so it needs a pattern instead of a fixed enum value - kept
// tight (letters/spaces/hyphens, capped length) so nothing arbitrary reaches
// the prompt.
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

// Kept in its own zero-import file (like plainText.ts) so the route and its
// test share the exact same schema without the test pulling in the
// prisma-importing chain (route.ts -> mcp/auth -> prisma).
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
