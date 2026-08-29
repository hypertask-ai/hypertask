export const shouldReleaseSecondaryStartupOnBoardRequest = ({
  isMobile,
}: {
  isMobile: boolean;
}) => !isMobile;

export const shouldEnableSecondaryStartup = ({
  projectRoute,
  releasedForAccount,
}: {
  projectRoute: boolean;
  releasedForAccount: boolean;
}) => !projectRoute || releasedForAccount;

export const shouldReleaseSecondaryStartupForTerminalBoard = ({
  isMobile,
  isFetching,
  hasNoBoards,
  hasNoSelectedBoard,
  projectsError,
  accessDenied,
  projectLookupFailed,
  hydrationFailed,
}: {
  isMobile: boolean;
  isFetching: boolean;
  hasNoBoards: boolean;
  hasNoSelectedBoard: boolean;
  projectsError: boolean;
  accessDenied: boolean;
  projectLookupFailed: boolean;
  hydrationFailed: boolean;
}) =>
  isMobile &&
  !isFetching &&
  (hasNoBoards ||
    hasNoSelectedBoard ||
    projectsError ||
    accessDenied ||
    projectLookupFailed ||
    hydrationFailed);
