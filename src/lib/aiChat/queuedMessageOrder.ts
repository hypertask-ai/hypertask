export type PrecedingAssistantLookup = (assistantMessageId: string) => Promise<{ createdAt: Date } | null>;

export async function resolveQueuedMessageCreatedAt(
  role: string,
  precedesMessageId: unknown,
  findAssistant: PrecedingAssistantLookup
): Promise<Date | undefined> {
  if (role !== "human" || typeof precedesMessageId !== "string") return undefined;
  const assistant = await findAssistant(precedesMessageId);
  return assistant ? new Date(assistant.createdAt.getTime() - 1) : undefined;
}
