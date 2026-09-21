interface AnnouncementRouter {
  push: (href: string) => void;
}

export const handleAnnouncementCtaClick = (
  url: string,
  router: AnnouncementRouter,
  onInternalNavigation?: () => void
) => {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASEURL || "https://app.hypertask.ai";

  if (url.includes(baseUrl)) {
    const path = url.replace(baseUrl, "");
    onInternalNavigation?.();
    router.push(path);
  } else {
    window.open(url, "_blank");
  }
};
