/**
 * Guards a control against clicks the user never aimed at it.
 *
 * Two ways that happens on a touch screen, both reported on the mobile task page:
 * a flick that begins on a full-width strip still ends as a click, and a control
 * that slides into the slot another one just vacated (the mic taking the send
 * button's place) receives the click from the tap on its predecessor.
 *
 * A real tap starts on the element and stays put, so anything else is stray.
 * Mouse input never produces a touch, so desktop clicks always pass.
 */
export const TAP_SLOP_PX = 10;

export type TapGuard = {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  /** True when this click should be ignored. Consumes the pending tap either way. */
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
