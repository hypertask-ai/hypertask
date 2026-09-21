import { env as appEnv } from "#env";
interface AnnouncementRouter {
  push: (href: string) => void;
}

export const handleAnnouncementCtaClick = (
  url: string,
  router: AnnouncementRouter,
  onInternalNavigation?: () => void
) => {
  const baseUrl = new URL(
    appEnv.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai",
  );
  const targetUrl = new URL(url, baseUrl);

  if (targetUrl.origin === baseUrl.origin) {
    onInternalNavigation?.();
    router.push(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
  } else {
    window.open(targetUrl.href, "_blank");
  }
};
