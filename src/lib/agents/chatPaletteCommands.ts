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
