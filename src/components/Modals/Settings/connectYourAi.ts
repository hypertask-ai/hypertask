export type ConnectProvider = "claude" | "chatgpt";

// ponytail: these deep links cannot be reached from CI or the build box, so they
// are unverified here. QA confirms them on a real Claude and a real ChatGPT
// account. The step copy below stays true even when a link only lands on the
// provider's home screen, so a stale route never leaves a false promise on
// screen. If a route moves, change the URL, not the wording.
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
