export const checkIfOnboarded = (user: { UserSetting?: { onboardingTourStatus?: boolean } | null }) => user.UserSetting?.onboardingTourStatus;
