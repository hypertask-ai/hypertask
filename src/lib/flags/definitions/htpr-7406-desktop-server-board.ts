import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7406_DESKTOP_SERVER_BOARD_FLAG = "htpr-7406-desktop-server-board";

export default {
  key: HTPR_7406_DESKTOP_SERVER_BOARD_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-20",
  description: "Shows the desktop board from the first page load when AI chat opens by default, with space already reserved at the user's chat width.",
  related: ["htpr-6934-server-first-screen"],
  releaseRisk: {
    risk: "small",
    reason: "Reserves the existing chat column while the board loads; the finished board and chat stay the same. The chat box fills its column about half a second later than today.",
  },
} as const satisfies FeatureFlagDefinition;
