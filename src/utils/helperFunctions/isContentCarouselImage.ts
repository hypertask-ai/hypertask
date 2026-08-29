type ClosestLookup = {
  closest: (selector: string) => unknown;
};

/** Excludes node-view preview images that are controls, not comment media. */
export const isContentCarouselImage = (image: ClosestLookup) =>
  !image.closest("[data-figma-embed-preview]");
