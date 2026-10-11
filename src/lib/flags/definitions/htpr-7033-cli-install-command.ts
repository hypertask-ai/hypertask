import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7033_CLI_INSTALL_COMMAND_FLAG = "htpr-7033-cli-install-command";

export default {
  key: HTPR_7033_CLI_INSTALL_COMMAND_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Uses the same pinned CLI installer in onboarding, demo tasks, Settings and help, with Windows download guidance.",
} as const satisfies FeatureFlagDefinition;
