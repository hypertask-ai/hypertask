export const MOBILE_BOARD_CONTROLS_RECOVERY_TIMEOUT_MS = 6_000;

export const shouldShowMobileBoardControls = ({
  projectRoute,
  boardUsable,
  recoveryTimedOut,
}: {
  projectRoute: boolean;
  boardUsable: boolean;
  recoveryTimedOut: boolean;
}): boolean => !projectRoute || boardUsable || recoveryTimedOut;
