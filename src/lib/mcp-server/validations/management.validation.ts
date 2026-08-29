import { z } from "zod";

export const CreateAgentInputSchema = z
  .object({
    display_name: z.string().trim().min(1).max(60),
    project_ids: z.array(z.number().int().positive()).max(100).default([]),
    role: z.enum(["read", "write", "admin"]).default("write"),
  })
  .strict();

export const RevokeAgentInputSchema = z
  .object({
    agent_id: z.string().trim().min(1),
  })
  .strict();

export const MintTokenInputSchema = z
  .object({
    expires_in_days: z.number().int().min(1).max(365).default(30),
  })
  .strict();

export const RevokeTokenInputSchema = z
  .object({
    token: z.string().trim().min(1).max(8192).optional(),
    revoke_all: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.token) !== Boolean(value.revoke_all), {
    message: "Provide exactly one of token or revoke_all=true",
  });

export const ListConnectionsInputSchema = z.object({}).strict();
