export type ConnectProvider = "claude" | "chatgpt";

export const CONNECT_PROVIDER_STEPS: Record<ConnectProvider, string[]> = {
  claude: [
    "Open Claude and choose Settings",
    "Choose Connectors, then Add custom connector",
    "Paste the Hypertask server link and choose Connect",
  ],
  chatgpt: [
    "Open ChatGPT and choose Settings",
    "Choose Apps and Connectors, then Create",
    "Paste the Hypertask server link and save the connector",
  ],
};

export function getOtherChatsCopy(serverUrl: string): string {
  return `Connect to Hypertask at ${serverUrl}.`;
}
