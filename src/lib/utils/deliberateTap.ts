export const TAP_SLOP_PX = 10;

export type TapGuard = {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  isStray: () => boolean;
};

export const createTapGuard = (slop: number = TAP_SLOP_PX): TapGuard => {
  let origin: { x: number; y: number } | null = null;
  let sawTouch = false;

  return {
    start(x, y) {
      sawTouch = true;
      origin = { x, y };
    },
    move(x, y) {
      if (!origin) return;
      if (Math.hypot(x - origin.x, y - origin.y) > slop) origin = null;
    },
    isStray() {
      const stray = sawTouch && !origin;
      origin = null;
      return stray;
    },
  };
};
