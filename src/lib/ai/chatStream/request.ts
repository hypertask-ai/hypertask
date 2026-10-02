import { z } from "zod";
import { SORTING_MODES } from "@/models/Views/model";
import { SseEvent } from "@/lib/ai/chatStream/types";

export const statusSchema = z.enum(["Normal", "Archive", "Deleted"]);

export const sortOrderSchema = z.enum(["asc", "desc"]);

export const viewSortingStackSchema = z
  .array(
    z
      .object({
        mode: z.enum(SORTING_MODES).exclude(["Manual"]),
        order: z.enum(["Ascending", "Descending"]),
      })
      .strict()
  )
  .max(2);

export const attachmentSchema = z.object({
  fileName: z.string().optional(),
  url: z.string().optional(),
  mimeType: z.string().nullable().optional(),
});

export const byokProviderFlagSchema = z
  .object({
    provider: z.string().optional().nullable(),
    enabled: z.boolean().optional(),
    ciphertext: z.string().nullable().optional(),
  })
  .passthrough();

export const defaultContextSchema = z
  .object({
    project_id: z.coerce.number().int().positive().optional(),
    task_id: z.coerce.number().int().positive().optional(),
    view_id: z.string().optional().nullable(),
    view_name: z.string().optional().nullable(),
    // Which screen the user is on. Board surfaces carry a project_id; My Tasks,
    // the inbox and the calendar span every board and carry none.
    surface: z.string().optional().nullable(),
    surface_path: z.string().optional().nullable(),
  })
  .passthrough();

export const chatRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().uuid().optional(),
  user_message_id: z.string().uuid().optional(),
  assistant_message_id: z.string().uuid().optional(),
  stream_id: z.string().uuid().optional(),
  heartbeat_execution_id: z.string().uuid().optional(),
  modelOptionId: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  provider: z.string().optional().nullable(),
  aiFeature: z.enum(["aiChat", "askAi"]).optional().default("aiChat"),
  teamId: z.string().optional().nullable(),
  context_list: z.array(z.unknown()).nullable().optional(),
  default_context: defaultContextSchema.nullable().optional(),
  user_context: z.record(z.string(), z.unknown()).nullable().optional(),
  chat_history: z
    .array(
      z
        .object({
          content: z.string().optional().default(""),
          role: z.string().optional().default("human"),
        })
        .passthrough()
    )
    .nullable()
    .optional(),
  images64: z.array(attachmentSchema).nullable().optional(),
  pdfs64: z.array(attachmentSchema).nullable().optional(),
  docx64: z.array(attachmentSchema).nullable().optional(),
  attachments: z.array(attachmentSchema).nullable().optional(),
  byokProviderFlags: z.array(byokProviderFlagSchema).nullable().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type SendSse = (event: SseEvent, data: Record<string, unknown>) => void;
