import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7933_PLAIN_LANGUAGE_TICKET_TEMPLATE_FLAG =
  "htpr-7933-plain-language-ticket-template";

export default {
  key: HTPR_7933_PLAIN_LANGUAGE_TICKET_TEMPLATE_FLAG,
  kind: "internal",
  defaultMode: "OWNER_AND_QA",
  description:
    "Agent ticket creates on internal boards and moves into Valentin Review require the plain-language recommendation block from docs/ticket-template.md.",
  releaseRisk: {
    risk: "medium",
    reason:
      "Refuses some agent ticket writes until bodies match the shared template; flag off restores today’s behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
