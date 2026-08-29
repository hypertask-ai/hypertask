import { useEffect, useRef } from "react";

type UseArchiveInfiniteScrollArgs = {
  enabled: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
};

export const useArchiveInfiniteScroll = ({
  enabled,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: UseArchiveInfiniteScrollArgs) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!enabled || !sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "240px 0px" }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [enabled, fetchNextPage, hasNextPage, isFetchingNextPage]);

  return sentinelRef;
};
