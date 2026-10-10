import { headers } from "next/headers";
import { notFound } from "next/navigation";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server layout enforces the same owner boundary as admin flags.
import { canUseAgentChat } from "@/lib/flags";
import type { ReactNode } from "react";

export default async function AgentChatLayout({ children }: { children: ReactNode }) {
  if (!(await canUseAgentChat(await headers()))) notFound();
  return children;
}
