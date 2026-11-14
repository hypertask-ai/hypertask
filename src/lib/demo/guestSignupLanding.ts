const BOARD_LANDING = /^\/project(?:[/?]|$)/;

export function guestSignupLandingUrl(redirectUrl: string | undefined | null): string {
  const target = redirectUrl && redirectUrl.startsWith("/") ? redirectUrl : "/";
  if (!BOARD_LANDING.test(target)) return target;
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}welcome_ai=1`;
}
