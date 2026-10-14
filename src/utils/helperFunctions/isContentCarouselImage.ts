type ClosestLookup = {
  closest: (selector: string) => unknown;
};

export const isContentCarouselImage = (image: ClosestLookup) =>
  !image.closest("[data-figma-embed-preview]");
