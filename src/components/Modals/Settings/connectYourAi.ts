export type ConnectProvider = "claude" | "chatgpt";

export const CONNECT_PROVIDER_SETUP_URLS: Record<ConnectProvider, string> = {
  claude: "https://claude.ai/settings/connectors",
  chatgpt: "https://chatgpt.com/#settings/Connectors",
};

export const CONNECT_PROVIDER_STEPS: Record<ConnectProvider, string[]> = {
  claude: [
    "Claude opens in a new tab",
    "Go to Settings, then Connectors, and choose Add custom connector",
    "Paste the Hypertask server link and choose Connect",
  ],
  chatgpt: [
    "ChatGPT opens in a new tab",
    "Go to Settings, then Apps and Connectors, and turn on Developer mode under Advanced",
    "Choose Create, paste the Hypertask server link and save the connector",
  ],
};

export function getOtherChatsCopy(serverUrl: string): string {
  return `Connect to Hypertask at ${serverUrl}.`;
}
