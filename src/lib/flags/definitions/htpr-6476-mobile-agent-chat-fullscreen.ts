import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG = "htpr-6476-mobile-agent-chat-fullscreen";

export default {
  key: HTPR_6476_MOBILE_AGENT_CHAT_FULLSCREEN_FLAG,
  kind: "feature",
  shippedOn: "2026-09-14",
  description:
    "On mobile Agent Chat with an agent open: hide the app top bar and bottom nav, slim the header to back plus name, and reuse the AI chat TipTap composer, mic, and send.",
  releaseRisk: {
    "risk": "small",
    "reason": "Mobile Agent Chat uses the existing AI composer in a full-screen layout."
  },
} as const satisfies FeatureFlagDefinition;
