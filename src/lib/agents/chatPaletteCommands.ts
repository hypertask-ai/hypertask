// Bridges the Ctrl+K palette (AllCommands.ts, dispatched from commands.tsx)
// into Agent Chat's page-local keyboard handlers (AgentChatClient.tsx),
// which own the actual roster/composer/team state the palette can't reach.
export const AGENT_CHAT_COMMAND_EVENT = "agent-chat:command";

export type TAgentChatCommand =
  | "next-agent"
  | "previous-agent"
  | "send-message"
  | "open-links"
  | "add-agent"
  | "next-team"
  | "previous-team";

export function dispatchAgentChatCommand(command: TAgentChatCommand) {
  window.dispatchEvent(
    new CustomEvent<TAgentChatCommand>(AGENT_CHAT_COMMAND_EVENT, {
      detail: command,
    }),
  );
}
